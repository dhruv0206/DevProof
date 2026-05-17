/**
 * Transactional email helper, backed by Resend.
 *
 * Falls back to console.log when RESEND_API_KEY is unset — that way local
 * dev works without anyone needing a Resend account.  Once the API key is
 * set (either in `.env.local` or on Vercel), real emails go out.
 *
 * Keep this module dependency-light — it's imported from API routes so it
 * runs in the Node.js runtime.
 */

import { Resend } from 'resend';

const FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const API_KEY = process.env.RESEND_API_KEY;

const resend: Resend | null = API_KEY ? new Resend(API_KEY) : null;

export interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

/**
 * Send a transactional email.
 *
 * In dev without an API key, logs the payload and returns `ok: true` so
 * the caller can keep flowing — useful when you'd like to copy a magic
 * link out of the backend terminal without setting up email.
 */
export async function sendEmail({
    to,
    subject,
    html,
    text,
}: SendEmailParams): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!resend) {
        console.log(
            '\n[email · DEV no-op — set RESEND_API_KEY to send for real]\n' +
                `  to:      ${to}\n` +
                `  from:    ${FROM}\n` +
                `  subject: ${subject}\n` +
                `  ─── body ─────────────────────────────────────────────\n` +
                `${text ? text : html.replace(/<[^>]+>/g, '')}\n` +
                `  ──────────────────────────────────────────────────────`,
        );
        return { ok: true };
    }

    try {
        const result = await resend.emails.send({
            from: FROM,
            to,
            subject,
            html,
            text,
        });
        if (result.error) {
            console.error('[email] resend error:', result.error);
            return { ok: false, error: result.error.message };
        }
        return { ok: true, id: result.data?.id };
    } catch (e) {
        console.error('[email] unexpected error:', e);
        return {
            ok: false,
            error: e instanceof Error ? e.message : 'unknown',
        };
    }
}


/**
 * Sends a magic-link sign-in email.
 *
 * Used by the self-serve `/hackathons/sign-in` flow when an organizer/
 * judge loses their session and needs a fresh link without going through
 * a platform admin.
 */
export async function sendMagicLinkEmail({
    to,
    name,
    hackathonName,
    magicLink,
}: {
    to: string;
    name: string;
    hackathonName: string;
    magicLink: string;
}): Promise<{ ok: boolean; error?: string }> {
    const greeting = name ? `Hi ${name},` : 'Hi,';

    const text = `${greeting}

You asked for a sign-in link to manage "${hackathonName}" on DevProof.

Click the link below to sign in. It's single-use and expires in 14 days.

  ${magicLink}

If you didn't request this, you can safely ignore this email — no
changes were made to your account.

— DevProof Hackathons`;

    const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 32px auto; padding: 0 24px; color: #111;">
    <p style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #888; margin: 0 0 24px;">DevProof &middot; Hackathons</p>
    <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 12px;">Sign in to ${escapeHtml(hackathonName)}</h1>
    <p style="font-size: 14px; line-height: 1.55; color: #444;">${escapeHtml(greeting)}</p>
    <p style="font-size: 14px; line-height: 1.55; color: #444;">
      Click the button below to sign in. The link is single-use and expires in 14 days.
    </p>
    <p style="margin: 24px 0;">
      <a href="${magicLink}" style="display: inline-block; background: #CC785C; color: #fff; padding: 10px 22px; border-radius: 6px; font-size: 14px; font-weight: 500; text-decoration: none;">Sign in</a>
    </p>
    <p style="font-size: 12px; line-height: 1.55; color: #777;">
      Or copy this link into your browser:<br />
      <span style="font-family: ui-monospace, SFMono-Regular, monospace; color: #444; word-break: break-all;">${escapeHtml(magicLink)}</span>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
    <p style="font-size: 12px; color: #999;">
      If you didn't request this, you can safely ignore this email — no
      changes were made to your account.
    </p>
  </body>
</html>`;

    return sendEmail({
        to,
        subject: `Sign in to ${hackathonName} on DevProof`,
        html,
        text,
    });
}


/**
 * Sends a team-invite email when a submitter invites a teammate by email.
 *
 * Subject + body kept short on purpose — the recipient lands on the invite
 * page, sees full hackathon + submission context there, and confirms in one
 * click. Email is the trigger, not the spec.
 */
export async function sendTeamInviteEmail({
    to,
    magicLink,
    inviterName,
    hackathonName,
}: {
    to: string;
    magicLink: string;
    inviterName?: string;
    hackathonName?: string;
}): Promise<{ ok: boolean; error?: string }> {
    const fromBit = inviterName
        ? `${inviterName} invited you`
        : 'You’ve been invited';
    const eventBit = hackathonName ? ` to their ${hackathonName} team` : ' to join a hackathon team';

    const text = `${fromBit}${eventBit} on DevProof.

Open the link below to view the project and accept. The link is single-use
and expires in 7 days.

  ${magicLink}

If you weren't expecting this, ignore the email — no changes will be made
to your account.

— DevProof Hackathons`;

    const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 32px auto; padding: 0 24px; color: #111;">
    <p style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #888; margin: 0 0 24px;">DevProof &middot; Team invite</p>
    <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 12px;">${escapeHtml(fromBit + eventBit)}</h1>
    <p style="font-size: 14px; line-height: 1.55; color: #444;">
      Open the link below to view the project and accept. The invite is single-use and expires in 7 days.
    </p>
    <p style="margin: 24px 0;">
      <a href="${magicLink}" style="display: inline-block; background: #CC785C; color: #fff; padding: 10px 22px; border-radius: 6px; font-size: 14px; font-weight: 500; text-decoration: none;">View invite</a>
    </p>
    <p style="font-size: 12px; line-height: 1.55; color: #777;">
      Or copy this link into your browser:<br />
      <span style="font-family: ui-monospace, SFMono-Regular, monospace; color: #444; word-break: break-all;">${escapeHtml(magicLink)}</span>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
    <p style="font-size: 12px; color: #999;">
      If you weren't expecting this, ignore the email — no changes will be made to your account.
    </p>
  </body>
</html>`;

    return sendEmail({
        to,
        subject: hackathonName
            ? `You're invited to a ${hackathonName} team`
            : 'You\'re invited to a hackathon team on DevProof',
        html,
        text,
    });
}


function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[c]!);
}
