/**
 * POST /api/hackathons-proxy/team-invites/[token]/decline
 *   Decline a team invite. Authenticated; same identity gate as accept.
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
        `${API_BASE_URL}/api/hackathons/team-invites/${encodeURIComponent(token)}/decline`,
        { method: 'POST', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
