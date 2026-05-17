/**
 * POST /api/hackathons-proxy/<slug>/judge/<token>/score
 *
 * Token-gated. Upserts a (submission_id, judge_name) score+notes row on
 * the FastAPI side. UNIQUE constraint there causes re-saves from the
 * same judge to update in place.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string; token: string }> },
) {
    const { slug, token } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/judge/${encodeURIComponent(token)}/score`,
        {
            method: 'POST',
            headers: fwdHeaders,
            body: JSON.stringify(body),
            cache: 'no-store',
        },
    );

    const respBody = await upstream.json().catch(() => ({}));
    return NextResponse.json(respBody, { status: upstream.status });
}
