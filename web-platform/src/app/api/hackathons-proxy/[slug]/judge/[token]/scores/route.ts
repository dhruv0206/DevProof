/**
 * GET /api/hackathons-proxy/<slug>/judge/<token>/scores?judge_name=...
 *
 * Token-gated. Returns the rows this judge_name has already saved, so the
 * judge UI can restore them on page reload.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string; token: string }> },
) {
    const { slug, token } = await ctx.params;
    const judgeName = req.nextUrl.searchParams.get('judge_name') || '';

    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const url = new URL(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/judge/${encodeURIComponent(token)}/scores`,
    );
    url.searchParams.set('judge_name', judgeName);

    const upstream = await fetch(url.toString(), {
        method: 'GET',
        headers: fwdHeaders,
        cache: 'no-store',
    });

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
