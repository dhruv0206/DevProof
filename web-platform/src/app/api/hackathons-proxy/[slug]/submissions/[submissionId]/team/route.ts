/**
 * GET /api/hackathons-proxy/[slug]/submissions/[id]/team
 *   List the submission's team (accepted members + pending invites).
 *   Authorized: submitter, accepted teammates, organizers/judges.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string; submissionId: string }> },
) {
    const { slug, submissionId } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/team`,
        { method: 'GET', headers: fwdHeaders, cache: 'no-store' },
    );

    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
