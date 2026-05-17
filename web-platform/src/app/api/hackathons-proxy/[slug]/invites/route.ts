/**
 * POST /api/hackathons-proxy/<slug>/invites — create invite
 *
 * Server-side proxy that forwards the BetterAuth session as `X-User-Id`
 * to the FastAPI backend. Session-only auth (legacy code-paste removed).
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> },
) {
    const { slug } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/invites`,
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
