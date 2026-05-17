/**
 * POST /api/hackathons-proxy/team-invites/[token]/accept
 *   Accept a team invite. Authenticated — identity is checked server-side
 *   against the invite's invited_user_id or invited_email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function POST(
    _req: NextRequest,
    ctx: { params: Promise<{ token: string }> },
) {
    const { token } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/team-invites/${encodeURIComponent(token)}/accept`,
        { method: 'POST', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
