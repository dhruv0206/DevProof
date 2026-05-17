/**
 * PATCH /api/hackathons-proxy/<slug>/submissions/<submissionId>/pin
 *
 * Toggle pin on a submission. Forwards to FastAPI with X-User-Id + secret.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function PATCH(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string; submissionId: string }> },
) {
    const { slug, submissionId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/pin`,
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
