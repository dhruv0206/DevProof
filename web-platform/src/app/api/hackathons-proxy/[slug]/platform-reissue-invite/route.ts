/**
 * POST /api/hackathons-proxy/<slug>/platform-reissue-invite
 *
 * Platform-admin-only proxy → forwards to FastAPI's narrow reissue
 * endpoint. Lets the platform admin mint a fresh magic-link invite for
 * an organizer/judge/observer WITHOUT entering the per-event admin UI
 * (which would expose submissions). Returns `{ token, magic_link }`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ slug: string }> },
) {
    const { slug } = await ctx.params;
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
        return NextResponse.json({ detail: 'auth required' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/admin/platform-reissue-invite`,
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
