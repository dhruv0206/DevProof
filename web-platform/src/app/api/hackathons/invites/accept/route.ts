/**
 * POST /api/hackathons/invites/accept?token=<token>
 *
 * Server-side proxy that forwards the BetterAuth session as `X-User-Id`
 * to the FastAPI backend's accept-invite endpoint. We do this in a Next
 * route (instead of calling FastAPI directly from the client) so the
 * session cookie stays HTTP-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function POST(req: NextRequest) {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
        return NextResponse.json(
            { detail: 'token query param required' },
            { status: 400 },
        );
    }

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
        return NextResponse.json(
            { detail: 'Authentication required' },
            { status: 401 },
        );
    }

    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/invites/accept/${encodeURIComponent(token)}`,
        {
            method: 'POST',
            headers: fwdHeaders,
            cache: 'no-store',
        },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
