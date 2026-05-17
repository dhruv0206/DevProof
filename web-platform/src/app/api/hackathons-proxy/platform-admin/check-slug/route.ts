/**
 * GET /api/hackathons-proxy/platform-admin/check-slug?slug=<slug>
 *   Live slug-availability check for the platform-admin "Create hackathon"
 *   form. Forwards to the FastAPI endpoint with proxy headers injected.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function GET(req: NextRequest) {
    const slug = req.nextUrl.searchParams.get('slug') ?? '';
    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/platform-admin/check-slug?slug=${encodeURIComponent(slug)}`,
        { method: 'GET', headers: fwdHeaders, cache: 'no-store' },
    );

    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
}
