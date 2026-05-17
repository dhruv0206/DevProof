/**
 * PATCH /api/hackathons-proxy/<slug>/admin/settings/sponsor-evidence
 *
 * Organizer-only. Body: { show_sponsor_evidence: boolean }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function PATCH(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> },
) {
    const { slug } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/admin/settings/sponsor-evidence`,
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
