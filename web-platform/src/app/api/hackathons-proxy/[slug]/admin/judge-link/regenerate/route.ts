/**
 * POST /api/hackathons-proxy/<slug>/admin/judge-link/regenerate
 *
 * Organizer-only. Generates (or rotates) the shareable judge URL on the
 * hackathon. Calling this when a token already exists REPLACES it — the
 * previous URL stops working immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function POST(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string }> },
) {
    const { slug } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/admin/judge-link/regenerate`,
        { method: 'POST', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
