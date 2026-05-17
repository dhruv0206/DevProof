/**
 * GET /api/hackathons-proxy/<slug>/admin/judge-scores
 *
 * Organizer/judge-tier. Aggregates every judge's scores+notes for every
 * submission in the hackathon, grouped by submission_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string }> },
) {
    const { slug } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/admin/judge-scores`,
        { method: 'GET', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
