/**
 * POST /api/hackathons/[slug]/publish — Next.js proxy that forwards the
 * publish call to FastAPI with `X-User-Id` resolved from BetterAuth session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function POST(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string }> },
) {
    const { slug } = await ctx.params;
    const reqHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/publish`,
        { method: 'POST', headers: reqHeaders, cache: 'no-store' },
    );
    const body = await upstream.text();
    return new NextResponse(body, {
        status: upstream.status,
        headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
}
