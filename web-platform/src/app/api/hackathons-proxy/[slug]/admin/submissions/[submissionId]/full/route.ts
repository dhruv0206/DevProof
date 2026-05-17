/**
 * GET /api/hackathons-proxy/<slug>/admin/submissions/<id>/full
 *
 * Organizer/judge-tier full submission detail (V4 audit output + sponsor
 * evidence if the show_sponsor_evidence toggle is on). Proxies to FastAPI.
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
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/admin/submissions/${encodeURIComponent(submissionId)}/full`,
        { method: 'GET', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
