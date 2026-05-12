/**
 * POST /api/hackathons/[slug]/publish — Next.js proxy that forwards the
 * publish call to FastAPI with the right auth headers.
 *
 * Why proxy: the FastAPI backend lives on a different origin (port 8000
 * locally, separate domain in prod). The browser-side admin cookie is
 * scoped to the Next.js domain only, so we can't ship it directly to
 * FastAPI from the client. The server-side route reads cookies + session
 * and forwards either ``X-User-Id`` or ``X-Hackathon-Admin-Code``.
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import { auth } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function POST(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string }> },
) {
    const { slug } = await ctx.params;

    const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        if (session?.user?.id) reqHeaders['X-User-Id'] = session.user.id;
    } catch {
        // No session — that's fine, code-cookie path may still authorize.
    }
    try {
        const cookieJar = await cookies();
        const c = cookieJar.get(`hk_admin_${slug}`);
        if (c?.value) reqHeaders['X-Hackathon-Admin-Code'] = c.value;
    } catch {
        // No cookie store — drop through.
    }

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
