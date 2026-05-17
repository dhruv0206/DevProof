/**
 * POST /api/hackathons-proxy/[slug]/submissions/[id]/team/invites
 *   Submitter-only. Create a team invite by username or email.
 *
 * On success, if the invite is email-based we also fire the magic-link
 * email here (the backend never sees the email credentials directly —
 * Resend lives in the Vercel env).
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';
import { sendTeamInviteEmail } from '@/lib/email';

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string; submissionId: string }> },
) {
    const { slug, submissionId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/team/invites`,
        {
            method: 'POST',
            headers: fwdHeaders,
            body: JSON.stringify(body),
            cache: 'no-store',
        },
    );
    const data = await upstream.json().catch(() => ({}));

    // Fire-and-forget email when the invite was created for an email
    // identifier. Failures are logged but don't fail the API call —
    // the magic link is also returned in the response so the submitter
    // can copy/share manually if email delivery breaks.
    if (
        upstream.ok &&
        typeof data?.invited_email === 'string' &&
        typeof data?.magic_link === 'string'
    ) {
        try {
            await sendTeamInviteEmail({
                to: data.invited_email,
                magicLink: data.magic_link,
            });
        } catch (e) {
            console.error('[team-invite] email send failed:', e);
        }
    }

    return NextResponse.json(data, { status: upstream.status });
}
