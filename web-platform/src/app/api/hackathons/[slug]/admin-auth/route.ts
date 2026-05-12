/**
 * POST /api/hackathons/[slug]/admin-auth — validate the organizer admin
 * code and set an httpOnly cookie. The cookie value is the code itself
 * (high-entropy, scoped per-hackathon). Server components on /admin pages
 * read the cookie and forward it to the FastAPI backend as the
 * `X-Hackathon-Admin-Code` header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> },
) {
    const { slug } = await ctx.params;
    const body = await req.json().catch(() => null);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code) {
        return NextResponse.json({ error: 'Code is required' }, { status: 400 });
    }

    // Validate against the FastAPI endpoint — single source of truth.
    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/admin-auth`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
            cache: 'no-store',
        },
    );
    if (!upstream.ok) {
        return NextResponse.json(
            { error: 'Invalid admin code' },
            { status: 403 },
        );
    }

    // Set the cookie. 30-day TTL, httpOnly so client JS can't read it,
    // path-restricted to the slug-scoped admin tree.
    const cookieJar = await cookies();
    cookieJar.set(`hk_admin_${slug}`, code, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/',
    });

    return NextResponse.json({ ok: true });
}
