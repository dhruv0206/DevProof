/**
 * GET /api/hackathons-proxy/<slug>/submissions/<submissionId>     — poll status
 * PATCH /api/hackathons-proxy/<slug>/submissions/<submissionId>   — retry audit / update
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string; submissionId: string }> },
) {
    const { slug, submissionId } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}`,
        { method: 'GET', headers: fwdHeaders, cache: 'no-store' },
    );

    const respBody = await upstream.json().catch(() => ({}));
    return NextResponse.json(respBody, { status: upstream.status });
}

export async function PATCH(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string; submissionId: string }> },
) {
    const { slug, submissionId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}`,
        {
            method: 'PATCH',
            headers: fwdHeaders,
            body: JSON.stringify(body),
            cache: 'no-store',
        },
    );

    const respBody = await upstream.json().catch(() => ({}));
    return NextResponse.json(respBody, { status: upstream.status });
}
