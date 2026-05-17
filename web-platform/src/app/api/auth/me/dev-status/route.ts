/**
 * GET /api/auth/me/dev-status
 *
 * Lightweight endpoint the client uses to learn whether the current
 * session belongs to a developer (has linked GitHub OAuth account) or an
 * organizer-only (magic-link only) user. Used by the global Header to
 * avoid showing "Audit your code" / "Sign in with GitHub" CTAs to
 * organizer-only users who already have a session but aren't developers.
 *
 * Response:
 *   200 { "signedIn": true,  "isDeveloper": true,  "name": "..." }
 *   200 { "signedIn": true,  "isDeveloper": false, "name": "..." }
 *   200 { "signedIn": false, "isDeveloper": false, "name": null   }
 *
 * Always 200 — no enumeration leak, no info beyond what session cookie
 * already proves.
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { userHasGithubLink } from '@/lib/dev-guard';

export async function GET() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
        return NextResponse.json({
            signedIn: false,
            isDeveloper: false,
            name: null,
        });
    }

    const isDeveloper = await userHasGithubLink(session.user.id);
    return NextResponse.json({
        signedIn: true,
        isDeveloper,
        name: (session.user as { name?: string }).name || null,
    });
}
