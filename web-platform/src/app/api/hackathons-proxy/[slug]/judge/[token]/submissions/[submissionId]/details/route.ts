/**
 * GET /api/hackathons-proxy/[slug]/judge/[token]/submissions/[id]/details
 *   Token-gated. Returns the full audit-detail view for a single submission
 *   so the judge view can expand a card to show claims / architecture /
 *   skills / score breakdown inline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function GET(
    _req: NextRequest,
    ctx: {
        params: Promise<{
            slug: string;
            token: string;
            submissionId: string;
        }>;
    },
) {
    const { slug, token, submissionId } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/judge/${encodeURIComponent(token)}/submissions/${encodeURIComponent(submissionId)}/details`,
        { method: 'GET', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
