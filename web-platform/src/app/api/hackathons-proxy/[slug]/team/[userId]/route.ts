/**
 * PATCH /api/hackathons-proxy/<slug>/team/<userId> — change role
 * DELETE /api/hackathons-proxy/<slug>/team/<userId> — remove member
 *
 * Session-only auth (legacy code-paste removed).
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function PATCH(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string; userId: string }> },
) {
    const { slug, userId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/team/${encodeURIComponent(userId)}`,
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

export async function DELETE(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string; userId: string }> },
) {
    const { slug, userId } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/team/${encodeURIComponent(userId)}`,
        { method: 'DELETE', headers: fwdHeaders, cache: 'no-store' },
    );

    if (upstream.status === 204) {
        return new NextResponse(null, { status: 204 });
    }
    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
