/**
 * Server-side fetchers for hackathon endpoints.
 *
 * IMPORTANT: backend authenticates via the ``X-User-Id`` header (set by
 * the Next.js layer after resolving the BetterAuth session), NOT via
 * the cookie directly. This matches the existing pattern in
 * ``DashboardContent.tsx`` / ``ProjectsList.tsx`` / etc. Forwarding only
 * the cookie returns 401 — the backend has no cookie-to-user middleware.
 *
 * Returns ``null`` on 404 / 403 so the caller can decide whether to
 * redirect or render a "not_found" state.
 */

import { headers, cookies } from 'next/headers';
import { auth } from './auth';
import type {
    HackathonDetail,
    AdminSubmissionsResponse,
    MyHackathonEvent,
    PinnedHackathonItem,
} from './types/hackathon';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Build headers including ``X-User-Id`` when an authenticated session
 * exists, and ``X-Hackathon-Admin-Code`` when the per-slug admin cookie
 * is set (code-paste login path for non-dev organizers). Public-only
 * endpoints can omit auth — they'll just not get the role-aware
 * enrichment.
 */
async function authHeaders(slug?: string): Promise<HeadersInit> {
    const result: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        if (session?.user?.id) {
            result['X-User-Id'] = session.user.id;
        }
    } catch {
        // Unauthenticated request — backend will return 401 / 403 as appropriate.
    }
    if (slug) {
        try {
            const cookieJar = await cookies();
            const adminCookie = cookieJar.get(`hk_admin_${slug}`);
            if (adminCookie?.value) {
                result['X-Hackathon-Admin-Code'] = adminCookie.value;
            }
        } catch {
            // No cookie store available — fine, drop through.
        }
    }
    return result;
}

export async function fetchHackathon(
    slug: string,
): Promise<HackathonDetail | null> {
    try {
        const res = await fetch(`${API_BASE_URL}/api/hackathons/${slug}`, {
            headers: await authHeaders(slug),
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return (await res.json()) as HackathonDetail;
    } catch {
        return null;
    }
}

export async function fetchAdminSubmissions(
    slug: string,
    opts: { audit_status?: string; sort?: string } = {},
): Promise<AdminSubmissionsResponse | null> {
    const qs = new URLSearchParams();
    if (opts.audit_status) qs.set('audit_status', opts.audit_status);
    if (opts.sort) qs.set('sort', opts.sort);
    const url = `${API_BASE_URL}/api/hackathons/${slug}/admin/submissions${qs.toString() ? `?${qs.toString()}` : ''}`;
    try {
        const res = await fetch(url, {
            headers: await authHeaders(slug),
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return (await res.json()) as AdminSubmissionsResponse;
    } catch {
        return null;
    }
}

/**
 * True when the slug-scoped admin cookie is present. Server-only — the
 * cookie is httpOnly so client JS can't observe it.
 */
export async function hasAdminCookie(slug: string): Promise<boolean> {
    try {
        const cookieJar = await cookies();
        return Boolean(cookieJar.get(`hk_admin_${slug}`)?.value);
    } catch {
        return false;
    }
}

/**
 * Fetch the logged-in user's hackathons (active + past). Returns ``null`` if
 * the user is unauthenticated or the call fails — caller should render an
 * empty/sign-in state rather than crashing.
 */
export async function fetchMyHackathons(): Promise<MyHackathonEvent[] | null> {
    try {
        const res = await fetch(`${API_BASE_URL}/api/hackathons/mine`, {
            headers: await authHeaders(),
            cache: 'no-store',
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { events: MyHackathonEvent[] };
        return body.events ?? [];
    } catch {
        return null;
    }
}

/** Public — pinned hackathons surfaced on /p/[username]. */
export async function fetchPinnedHackathons(
    username: string,
): Promise<PinnedHackathonItem[]> {
    try {
        const res = await fetch(
            `${API_BASE_URL}/api/hackathons/pinned-by/${encodeURIComponent(username)}`,
            { next: { revalidate: 60 } },
        );
        if (!res.ok) return [];
        const body = (await res.json()) as { pinned: PinnedHackathonItem[] };
        return body.pinned ?? [];
    } catch {
        return [];
    }
}
