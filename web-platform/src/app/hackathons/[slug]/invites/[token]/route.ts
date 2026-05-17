/**
 * /hackathons/<slug>/invites/<token> — magic-link landing.
 *
 * GET  — render-only. Looks up the invite and shows a confirmation page with
 *        an "Accept" button. NO database writes, NO session minting. This
 *        means link-unfurlers (Outlook Safe Links, Slack/Discord previewers,
 *        anti-malware scanners) that pre-fetch the URL CANNOT burn the
 *        token or mint a session — only an explicit POST does.
 *
 * POST — does the actual work atomically:
 *          1. Re-validate the invite is still active
 *          2. Resolve the invitee user (by invited_email) or use the
 *             currently authenticated user
 *          3. If both an existing session AND invited_email are present,
 *             require an exact match (defense in depth — backend also
 *             checks)
 *          4. Mark invite used + upsert hackathon_role in a transaction
 *          5. Mint BetterAuth-compatible session cookie
 *          6. Redirect to the role's landing page
 *
 * Why the GET/POST split (the only nontrivial change vs the previous flow):
 *   • Outlook Safe Links / Slack / Discord preview-fetch the URL with GET
 *     before the legitimate recipient ever clicks it. The previous handler
 *     burned the token and minted a session on that prefetch — meaning the
 *     real recipient saw "already used" and any actor able to intercept
 *     the prefetch could have inherited the session.
 *   • A GET that only reads is safe to prefetch; the POST requires
 *     an explicit user click (form submit) which scanners don't perform.
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { pool } from '@/lib/db';
import { auth } from '@/lib/auth';
import crypto from 'crypto';

interface Params {
    slug: string;
    token: string;
}


// ─── GET — render-only landing page ────────────────────────────────────────

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<Params> },
) {
    const { slug, token } = await ctx.params;
    const origin = req.nextUrl.origin;

    const inv = await lookupInviteForRender(token);
    if (!inv.ok) return errorPage(origin, inv.title, inv.body);

    return confirmPage({
        origin,
        slug,
        token,
        hackathonName: inv.hackathonName,
        role: inv.role,
        expiresAt: inv.expiresAt,
    });
}


// ─── POST — perform accept + mint session ──────────────────────────────────

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<Params> },
) {
    const { slug, token } = await ctx.params;
    const origin = req.nextUrl.origin;

    // Step 1: look up invite + check active (re-validates inside transaction
    // boundary; same query as GET but here we ALSO read invited_email)
    const inviteRes = await pool.query(
        `SELECT i.id, i.hackathon_id, i.invited_email, i.role,
                i.expires_at, i.used_at, i.revoked_at, i.invited_by,
                h.slug AS h_slug, h.name AS h_name
         FROM hackathon_invite i
         JOIN hackathon h ON h.id = i.hackathon_id
         WHERE i.token = $1
         LIMIT 1`,
        [token],
    );
    if (inviteRes.rowCount === 0) {
        return errorPage(origin, 'Invite not found',
            'The link you followed is invalid. Ask whoever invited you for a fresh one.');
    }
    const inv = inviteRes.rows[0];

    if (inv.revoked_at !== null) {
        return errorPage(origin, 'Invite revoked',
            'This invite has been revoked. Ask the organizer for a new one if you still need access.');
    }
    if (inv.used_at !== null) {
        return errorPage(origin, 'Invite already used',
            'This magic link can only be used once. If you already have access, sign in directly.');
    }
    const now = new Date();
    if (new Date(inv.expires_at) < now) {
        return errorPage(origin, 'Invite expired',
            'This invite expired. Ask the organizer to send a fresh one.');
    }

    // Step 2: determine which user this accept applies to.
    //   • If the caller already has a BetterAuth session, use THAT user
    //     and require their email to match invited_email (defense in
    //     depth — backend enforces too).
    //   • Otherwise, resolve user by invited_email (email-only organizer
    //     flow).
    let userId: string | null = null;

    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) {
        const sessionEmail = ((session.user as { email?: string }).email || '').trim().toLowerCase();
        const invitedEmail = (inv.invited_email || '').trim().toLowerCase();
        // CRITICAL: do NOT short-circuit the mismatch check on a missing
        // sessionEmail. A GitHub OAuth account with private email yields
        // sessionEmail === '', and `sessionEmail !== invitedEmail` correctly
        // evaluates to true — we WANT to reject. The previous form
        // (`&& sessionEmail && sessionEmail !== invitedEmail`) skipped the
        // check entirely when sessionEmail was empty, letting any signed-in
        // user claim an email-bound role.
        if (invitedEmail && sessionEmail !== invitedEmail) {
            return errorPage(origin, 'Wrong account',
                `This invite was issued for ${maskEmail(inv.invited_email)}. ` +
                'Sign out and sign back in with the invited email (your DevProof account ' +
                'must have a verified email matching the invite).');
        }
        // Defense-in-depth: refuse to grant a role to a caller whose own
        // account is unverified. Together with the disabled
        // `accountLinking` (lib/auth.ts), this means there's no path for
        // an unverified user to acquire roles through the session branch.
        const sessionVerified = (session.user as { emailVerified?: boolean }).emailVerified === true;
        if (!sessionVerified) {
            return errorPage(origin, 'Verify your email first',
                'Your DevProof account hasn\'t been email-verified yet. ' +
                'Sign out, click the magic link from your invite email (it verifies ' +
                'you in one step), and you\'ll land back here automatically.');
        }
        userId = session.user.id;
    } else if (inv.invited_email) {
        // Resolve (or create) the user by invited_email. Organizers don't
        // need GitHub OAuth — the magic-link click is their
        // email-ownership proof (same UX as Slack/Linear/Notion). The
        // user is then atomically marked emailVerified=TRUE inside the
        // transaction below.
        //
        // Defense against skeleton-user pre-takeover: BetterAuth's
        // `accountLinking` is disabled in lib/auth.ts, so an unverified
        // skeleton created here cannot be silently hijacked by someone
        // else's later GitHub OAuth sign-in (BetterAuth will refuse to
        // auto-merge into the existing email row at all).
        //
        // LOWER(email) defends against case mismatches in legacy rows.
        const normalizedEmail = String(inv.invited_email).trim().toLowerCase();
        const userRes = await pool.query<{ id: string }>(
            'SELECT id FROM "user" WHERE LOWER(email) = $1 LIMIT 1',
            [normalizedEmail],
        );
        if (userRes.rowCount && userRes.rowCount > 0) {
            userId = userRes.rows[0].id;
        } else {
            // First-time organizer/judge/observer invited via the UI —
            // create a fresh user row. emailVerified stays FALSE for now;
            // the atomic UPDATE in the transaction below flips it to
            // TRUE when this invite is accepted.
            userId = crypto.randomBytes(16).toString('base64url');
            const namePart = normalizedEmail.split('@')[0] || normalizedEmail;
            await pool.query(
                `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
                 VALUES ($1, $2, $3, FALSE, $4, $4)`,
                [userId, namePart, normalizedEmail, now],
            );
        }
    }
    if (!userId) {
        // Only reachable for open invites (invited_email IS NULL) clicked
        // by a logged-out caller — there's no email to bind to and no
        // session to use, so we can't safely create or attach a role.
        return errorPage(origin, 'Sign in to accept',
            'This invite isn\'t bound to a specific email. Sign in to DevProof ' +
            'first, then click the invite link again to accept.');
    }

    // Step 3-4: do EVERYTHING (invite-mark-used + role upsert + session insert)
    // inside a single transaction on a single pooled connection.
    //
    // Why this matters: `pool.query()` acquires a fresh connection from the
    // pool per call, so a sequence of `pool.query('BEGIN') / ... / pool.query
    // ('COMMIT')` does NOT actually bracket the intervening statements in a
    // transaction — each call runs in its own implicit autocommit. We must
    // call `pool.connect()` to pin one client and run BEGIN/.../COMMIT on it.
    //
    // We also gate the "single-use" claim on the UPDATE's rowCount: if the
    // WHERE used_at IS NULL clause matched 0 rows, a concurrent POST already
    // accepted this token — bail out without minting a session.
    const sessionToken = crypto.randomBytes(32).toString('base64url');
    const sessionId = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days — matches lib/auth.ts session.expiresIn
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null;
    const userAgent = req.headers.get('user-agent') || null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Claim the invite: rowCount === 1 means we won the race; 0 means
        // another concurrent caller already consumed this token.
        const claim = await client.query(
            `UPDATE hackathon_invite
                SET used_at = $1, accepted_by = $2
              WHERE id = $3 AND used_at IS NULL`,
            [now, userId, inv.id],
        );
        if (claim.rowCount === 0) {
            await client.query('ROLLBACK');
            return errorPage(origin, 'Invite already used',
                'This magic link can only be used once. If you already have access, sign in directly.');
        }

        // Upsert hackathon_role.
        const existing = await client.query(
            'SELECT id FROM hackathon_role WHERE hackathon_id = $1 AND user_id = $2',
            [inv.hackathon_id, userId],
        );
        if (existing.rowCount === 0) {
            await client.query(
                `INSERT INTO hackathon_role (id, hackathon_id, user_id, role, created_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
                [inv.hackathon_id, userId, inv.role, now],
            );
        } else {
            await client.query(
                'UPDATE hackathon_role SET role = $1 WHERE id = $2',
                [inv.role, existing.rows[0].id],
            );
        }

        // Mark the user as email-verified IF they came via the no-session
        // invited_email branch — clicking a magic link from one's own
        // inbox is proof of email ownership (standard email-magic-link
        // verification pattern). For users who arrived with an existing
        // BetterAuth session, emailVerified was already set by whichever
        // OAuth provider they used originally; this UPDATE is a no-op for
        // them. We do it inside the transaction so a failure rolls it
        // back along with the rest.
        await client.query(
            `UPDATE "user"
                SET "emailVerified" = TRUE, "updatedAt" = $1
              WHERE id = $2 AND "emailVerified" IS DISTINCT FROM TRUE`,
            [now, userId],
        );

        // Session row last — keeps it inside the same atomic unit so a failure
        // in any earlier step rolls back the (would-be) session too.
        await client.query(
            `INSERT INTO session (id, token, "userId", "expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent")
             VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
            [sessionId, sessionToken, userId, expiresAt, now, ipAddress, userAgent],
        );

        await client.query('COMMIT');
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* swallow */ }
        console.error('[magic-link] role/invite/session transaction failed:', e);
        return errorPage(origin, 'Something went wrong',
            'We couldn\'t complete the invite. Try again or ask the organizer for help.');
    } finally {
        client.release();
    }

    // Step 5: set BetterAuth-format signed cookie.
    //
    // Signature byte-for-byte compatible with better-call's signCookieValue:
    //   makeSignature   = btoa(String.fromCharCode(...HMAC-SHA256(value)))
    //                   = standard base64 (not hex, not base64url)
    //   signCookieValue = encodeURIComponent(`${value}.${signature}`)
    // Next.js's cookies.set() runs encodeURIComponent internally, so we
    // pass the raw `${token}.${signature}` and let Next encode once.
    const baseURL: string =
        (auth.options as { baseURL?: string }).baseURL ||
        process.env.BETTER_AUTH_URL ||
        '';
    const secret: string | undefined =
        (auth.options as { secret?: string }).secret ||
        process.env.BETTER_AUTH_SECRET;

    if (!secret) {
        console.error('[magic-link] BETTER_AUTH_SECRET not configured');
        return errorPage(origin, 'Server misconfiguration',
            'Magic-link auth needs BETTER_AUTH_SECRET set. Contact the operator.');
    }

    const useSecureCookies = baseURL
        ? baseURL.startsWith('https://')
        : process.env.NODE_ENV === 'production';
    const cookieName = useSecureCookies
        ? '__Secure-better-auth.session_token'
        : 'better-auth.session_token';

    const signature = crypto
        .createHmac('sha256', secret)
        .update(sessionToken)
        .digest('base64');
    const cookieValue = `${sessionToken}.${signature}`;

    const redirectPath =
        inv.role === 'organizer'
            ? `/hackathons/${slug}/admin`
            : `/hackathons/${slug}`;

    const response = NextResponse.redirect(new URL(redirectPath, origin), { status: 303 });
    response.cookies.set(cookieName, cookieValue, {
        httpOnly: true,
        secure: useSecureCookies,
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
    });
    return response;
}


// ─── Helpers ────────────────────────────────────────────────────────────────

type LookupResult =
    | { ok: true; hackathonName: string; role: string; expiresAt: Date }
    | { ok: false; title: string; body: string };

async function lookupInviteForRender(token: string): Promise<LookupResult> {
    const inviteRes = await pool.query(
        `SELECT i.expires_at, i.used_at, i.revoked_at, i.role,
                h.name AS h_name
         FROM hackathon_invite i
         JOIN hackathon h ON h.id = i.hackathon_id
         WHERE i.token = $1
         LIMIT 1`,
        [token],
    );
    if (inviteRes.rowCount === 0) {
        return {
            ok: false,
            title: 'Invite not found',
            body: 'The link you followed is invalid. Ask whoever invited you for a fresh one.',
        };
    }
    const row = inviteRes.rows[0];
    if (row.revoked_at !== null) {
        return {
            ok: false,
            title: 'Invite revoked',
            body: 'This invite has been revoked. Ask the organizer for a new one if you still need access.',
        };
    }
    if (row.used_at !== null) {
        return {
            ok: false,
            title: 'Invite already used',
            body: 'This magic link can only be used once. If you already have access, sign in directly.',
        };
    }
    if (new Date(row.expires_at) < new Date()) {
        return {
            ok: false,
            title: 'Invite expired',
            body: 'This invite expired. Ask the organizer to send a fresh one.',
        };
    }
    return {
        ok: true,
        hackathonName: row.h_name,
        role: row.role,
        expiresAt: new Date(row.expires_at),
    };
}


function confirmPage(opts: {
    origin: string;
    slug: string;
    token: string;
    hackathonName: string;
    role: string;
    expiresAt: Date;
}): NextResponse {
    const { origin, slug, token, hackathonName, role, expiresAt } = opts;
    const roleLabel = roleShort(role);
    const expiresHuman = expiresAt.toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
    });

    // Plain HTML form that POSTs to the same URL. No JS required, so
    // works without React hydration, and link-unfurlers (which do GET)
    // never trigger the side effects.
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Accept invite — DevProof Hackathons</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
           background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 0; }
    .wrap { max-width: 32rem; margin: 6rem auto; padding: 0 2rem; text-align: center; }
    h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.025em; margin: 0 0 1rem; }
    p { color: #aaa; font-size: 0.95rem; line-height: 1.55; margin: 0 0 1rem; }
    .meta { color: #888; font-size: 0.825rem; margin: 1.5rem 0 2rem; }
    button { background: #CC785C; color: #fff; border: 0; border-radius: 6px;
             font-size: 0.875rem; font-weight: 500; padding: 0.625rem 1.5rem;
             cursor: pointer; font-family: inherit; }
    button:hover { opacity: 0.9; }
    a { color: #CC785C; text-decoration: underline; font-size: 0.8125rem; }
    .fine { color: #666; font-size: 0.75rem; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>You're invited</h1>
    <p>You've been invited to manage <strong>${escapeHtml(hackathonName)}</strong> as <strong>${escapeHtml(roleLabel)}</strong>.</p>
    <p class="meta">Link expires ${escapeHtml(expiresHuman)} · one-time use</p>
    <form method="POST" action="/hackathons/${encodeURIComponent(slug)}/invites/${encodeURIComponent(token)}">
      <button type="submit">Accept invite as ${escapeHtml(roleLabel)}</button>
    </form>
    <p class="fine">Once you accept, this link can't be used again.</p>
    <p><a href="${origin}/hackathons">Back to hackathons</a></p>
  </div>
</body>
</html>`;
    return new NextResponse(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
        },
    });
}


function errorPage(origin: string, title: string, body: string): NextResponse {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)} — DevProof Hackathons</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
           background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 0; }
    .wrap { max-width: 32rem; margin: 6rem auto; padding: 0 2rem; text-align: center; }
    h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.025em; margin: 0 0 1rem; }
    p { color: #888; font-size: 0.9rem; line-height: 1.5; }
    a { color: #CC785C; text-decoration: underline; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    <p><a href="${origin}/hackathons">Back to hackathons</a></p>
  </div>
</body>
</html>`;
    return new NextResponse(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
        },
    });
}


function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]!));
}


function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '••••';
    const masked = local.length <= 2
        ? '•'.repeat(local.length)
        : local[0] + '•'.repeat(Math.max(0, local.length - 2)) + local.slice(-1);
    return `${masked}@${domain}`;
}


function roleShort(role: string): string {
    switch (role) {
        case 'organizer': return 'Organizer';
        case 'judge': return 'Judge';
        case 'observer': return 'Observer';
        default: return role;
    }
}
