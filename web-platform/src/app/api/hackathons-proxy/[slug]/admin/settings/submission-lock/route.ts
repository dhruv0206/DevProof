/**
 * PATCH /api/hackathons-proxy/[slug]/admin/settings/submission-lock
 *   Organizer-only. Flip the manual lock toggle and/or update the scheduled
 *   submissions_close_at datetime.
 *
 * Body: { locked_override?: boolean, submissions_close_at?: string | null }
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
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/admin/settings/submission-lock`,
        {
            method: 'PATCH',
            headers: fwdHeaders,
            body: JSON.stringify(body),
            cache: 'no-store',
        },
    );

    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
}
