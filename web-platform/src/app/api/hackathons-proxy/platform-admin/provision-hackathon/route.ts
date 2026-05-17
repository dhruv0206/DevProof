/**
 * POST /api/hackathons-proxy/platform-admin/provision-hackathon
 *   Platform-admin-only. Creates a new hackathon + organizer user +
 *   ORGANIZER role + magic-link invite, and returns the magic link the
 *   platform admin can copy and send.
 *
 * Body: {
 *   email, name?, hackathon_slug, hackathon_name,
 *   starts_at?, ends_at?, invite_expires_days?
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const fwdHeaders = await buildProxyHeaders();

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/platform-admin/provision-hackathon`,
        {
            method: 'POST',
            headers: fwdHeaders,
            body: JSON.stringify(body),
            cache: 'no-store',
        },
    );

    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
}
