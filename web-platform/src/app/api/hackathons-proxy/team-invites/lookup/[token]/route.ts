/**
 * GET /api/hackathons-proxy/team-invites/lookup/[token]
 *   Public preview of a team invite — used by the landing page to render
 *   hackathon + submission context before the recipient has accepted.
 *
 * Uses the proxy layer so the internal secret + (optional) session user
 * are forwarded; no client-visible secrets.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ token: string }> },
) {
    const { token } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/team-invites/lookup/${encodeURIComponent(token)}`,
        { method: 'GET', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
