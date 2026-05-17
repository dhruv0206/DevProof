/**
 * POST /api/hackathons/auth/request-link — self-serve magic-link request.
 *
 * Public endpoint that lets organizers/judges/observers ask for a fresh
 * sign-in link when their session has expired or they're on a new
 * device.  Body: ``{"email": "..."}``.
 *
 * Security:
 *   - NO enumeration leak: response is always 200 with the same body,
 *     regardless of whether the email is registered or has any roles.
 *   - Rate-limited: 1 request per email per 60 seconds, 5 per hour.
 *     In-memory limiter (good enough for single-instance dev + Vercel
 *     single-region; switch to Upstash/Redis when we scale out).
 *   - Generates a single-use token (32 chars), 14-day expiry.
 *
 * If a user has multiple active hackathon roles, we pick the most
 * recently-created event they have access to and mint a link for that.
 * (Multi-event picker UX is a future enhancement.)
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool } from '@/lib/db';
import { sendMagicLinkEmail } from '@/lib/email';

const COOLDOWN_MS = 60 * 1000; // 60 seconds between requests per email
const HOURLY_CAP = 5;          // max requests per email per hour
const HOURLY_WINDOW_MS = 60 * 60 * 1000;

interface RateState {
    last: number;
    timestamps: number[];
}
const rateLimits = new Map<string, RateState>();

function checkRateLimit(key: string): { ok: boolean; retryAfter?: number } {
    const now = Date.now();
    const state = rateLimits.get(key);
    if (!state) {
        rateLimits.set(key, { last: now, timestamps: [now] });
        return { ok: true };
    }

    if (now - state.last < COOLDOWN_MS) {
        return { ok: false, retryAfter: COOLDOWN_MS - (now - state.last) };
    }

    state.timestamps = state.timestamps.filter(
        (t) => now - t < HOURLY_WINDOW_MS,
    );
    if (state.timestamps.length >= HOURLY_CAP) {
        return { ok: false, retryAfter: HOURLY_WINDOW_MS };
    }

    state.last = now;
    state.timestamps.push(now);
    return { ok: true };
}


/**
 * Dev bypass: in non-prod environments without a Resend API key, we ALSO
 * return the freshly-minted magic link in the response so the frontend can
 * show it inline instead of forcing you to dig through the backend log.
 *
 * In production this MUST stay off regardless of Resend state — otherwise
 * any anonymous caller could request a link for any registered organizer's
 * email and immediately use it to sign in as them. Gated on NODE_ENV
 * (Vercel sets this to 'production' automatically) so a misconfigured prod
 * env (missing/expired RESEND_API_KEY) fails closed rather than leaking
 * sign-in URLs.
 */
const DEV_RETURN_LINK =
    process.env.NODE_ENV !== 'production' && !process.env.RESEND_API_KEY;


export async function POST(req: NextRequest) {
    const origin = req.nextUrl.origin;
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const email = rawEmail.trim().toLowerCase();

    // Always-200 response shape so we don't leak which emails are
    // registered.  Caller hides everything behind "check your inbox".
    const GENERIC_OK = NextResponse.json({ ok: true });

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return GENERIC_OK;
    }

    const rl = checkRateLimit(email);
    if (!rl.ok) return GENERIC_OK;

    try {
        // 1. Look up the user by email
        const userRes = await pool.query<{ id: string; name: string | null }>(
            'SELECT id, name FROM "user" WHERE email = $1 LIMIT 1',
            [email],
        );
        if (userRes.rowCount === 0) {
            // No such user — silent OK (no enumeration leak)
            return GENERIC_OK;
        }
        const user = userRes.rows[0];

        // 2. Find their hackathon roles — pick the most recently-created
        //    event they have a role on.  Organizer beats judge beats
        //    observer if there's a tie.
        const roleRes = await pool.query<{
            hackathon_id: string;
            slug: string;
            name: string;
            role: string;
        }>(
            `SELECT h.id AS hackathon_id, h.slug, h.name, r.role
             FROM hackathon_role r
             JOIN hackathon h ON h.id = r.hackathon_id
             WHERE r.user_id = $1
             ORDER BY
               CASE r.role
                 WHEN 'organizer' THEN 0
                 WHEN 'judge'     THEN 1
                 WHEN 'observer'  THEN 2
                 ELSE 3
               END,
               h.created_at DESC
             LIMIT 1`,
            [user.id],
        );
        if (roleRes.rowCount === 0) {
            // No hackathon roles — silent OK
            return GENERIC_OK;
        }
        const target = roleRes.rows[0];

        // 3. Mint a fresh invite tied to this event
        const token = crypto.randomBytes(24).toString('base64url');
        const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO hackathon_invite
                (hackathon_id, invited_email, invited_by, role, token,
                 expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [target.hackathon_id, email, user.id, target.role, token, expires],
        );

        // 4. Send the email
        const magicLink = `${origin}/hackathons/${target.slug}/invites/${token}`;
        try {
            await sendMagicLinkEmail({
                to: email,
                name: user.name || email.split('@')[0],
                hackathonName: target.name,
                magicLink,
            });
        } catch (sendErr) {
            // In prod: log + return generic OK. Never surface the link.
            // In non-prod: fall through to DEV_RETURN_LINK so local dev
            // (where Resend is intentionally disabled) still works.
            if (process.env.NODE_ENV === 'production') {
                console.error('[request-link] email send failed:', sendErr);
                return GENERIC_OK;
            }
        }

        if (DEV_RETURN_LINK) {
            return NextResponse.json({ ok: true, dev_link: magicLink });
        }
    } catch (e) {
        console.error('[request-link] error:', e);
        // Still 200 — don't reveal internal state to probes
    }

    return GENERIC_OK;
}
