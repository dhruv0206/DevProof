/**
 * DELETE /api/hackathons-proxy/[slug]/submissions/[id]/team/invites/[inviteId]
 *   Submitter-only. Revoke a pending invite or remove an accepted teammate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

export async function DELETE(
    _req: NextRequest,
    ctx: { params: Promise<{ slug: string; submissionId: string; inviteId: string }> },
) {
    const { slug, submissionId, inviteId } = await ctx.params;
    const fwdHeaders = await buildProxyHeaders({ noContentType: true });

    const upstream = await fetch(
        `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/team/invites/${encodeURIComponent(inviteId)}`,
        { method: 'DELETE', headers: fwdHeaders, cache: 'no-store' },
    );

    if (upstream.status === 204) {
        return new NextResponse(null, { status: 204 });
    }
    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
}
