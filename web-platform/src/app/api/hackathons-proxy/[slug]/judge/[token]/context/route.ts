/**
 * GET /api/hackathons-proxy/<slug>/judge/<token>/context
 *
 * Token-gated, anonymous-OK. Returns hackathon meta + all SUBMITTED
 * submissions for the judge UI to render. The token in the URL is the
 * sole credential — judges don't need DevProof accounts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string; token: string }> },
) {
    const { slug, token } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/judge/${encodeURIComponent(token)}/context`,
        { method: 'GET', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
