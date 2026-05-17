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

import { headers } from 'next/headers';
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
 * exists, plus the ``X-Internal-Proxy-Secret`` shared secret so FastAPI
 * trusts the X-User-Id claim. The secret is server-only — exposing it on
 * the client (e.g. ``NEXT_PUBLIC_`` prefix) would defeat the gate.
 */
async function authHeaders(): Promise<HeadersInit> {
    const result: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    const internalSecret = process.env.INTERNAL_PROXY_SECRET;
    if (internalSecret) {
        result['X-Internal-Proxy-Secret'] = internalSecret;
    }
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        if (session?.user?.id) {
            result['X-User-Id'] = session.user.id;
        }
    } catch {
        // Unauthenticated request — backend will return 401 / 403 as appropriate.
    }
    return result;
}

export async function fetchHackathon(
    slug: string,
): Promise<HackathonDetail | null> {
    try {
        const res = await fetch(`${API_BASE_URL}/api/hackathons/${slug}`, {
            headers: await authHeaders(),
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
            headers: await authHeaders(),
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return (await res.json()) as AdminSubmissionsResponse;
    } catch {
        return null;
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

/** Multi-admin: hackathons where the current user has ORGANIZER role. */
export interface AdminHackathonSummary {
    id: string;
    slug: string;
    name: string;
    starts_at: string | null;
    ends_at: string | null;
    published_at: string | null;
    submission_count: number;
    team_count: number;
}

export interface AdminMineResult {
    hackathons: AdminHackathonSummary[];
    /** True when the current user has the platform-admin flag set. */
    isPlatformAdmin: boolean;
}

export async function fetchMyAdminHackathons(): Promise<AdminMineResult> {
    try {
        const res = await fetch(`${API_BASE_URL}/api/hackathons/admin/mine`, {
            headers: await authHeaders(),
            cache: 'no-store',
        });
        if (!res.ok) return { hackathons: [], isPlatformAdmin: false };
        const body = (await res.json()) as {
            hackathons: AdminHackathonSummary[];
            is_platform_admin?: boolean;
        };
        return {
            hackathons: body.hackathons ?? [],
            isPlatformAdmin: !!body.is_platform_admin,
        };
    } catch {
        return { hackathons: [], isPlatformAdmin: false };
    }
}

/** Invite + team management API helpers. */
export interface InviteSummary {
    id: string;
    hackathon_id: string;
    role: string;
    invited_email: string | null;
    invited_by: string;
    token: string;
    magic_link: string;
    expires_at: string;
    used_at: string | null;
    accepted_by: string | null;
    revoked_at: string | null;
    status: 'pending' | 'accepted' | 'expired' | 'revoked';
    created_at: string;
}

export async function fetchInvites(slug: string): Promise<InviteSummary[]> {
    try {
        const res = await fetch(`${API_BASE_URL}/api/hackathons/${slug}/invites`, {
            headers: await authHeaders(),
            cache: 'no-store',
        });
        if (!res.ok) return [];
        const body = (await res.json()) as { invites: InviteSummary[] };
        return body.invites ?? [];
    } catch {
        return [];
    }
}

export interface TeamMember {
    user_id: string;
    username: string | null;
    name: string | null;
    email: string | null;
    role: 'organizer' | 'judge' | 'observer';
    joined_at: string;
}

export async function fetchTeam(slug: string): Promise<TeamMember[]> {
    try {
        const res = await fetch(`${API_BASE_URL}/api/hackathons/${slug}/team`, {
            headers: await authHeaders(),
            cache: 'no-store',
        });
        if (!res.ok) return [];
        const body = (await res.json()) as { team: TeamMember[] };
        return body.team ?? [];
    } catch {
        return [];
    }
}

export interface InviteLookup {
    hackathon: { id: string; slug: string; name: string };
    role: string;
    invited_email: string | null;
    status: 'pending' | 'accepted' | 'expired' | 'revoked';
    expires_at: string;
}

export async function lookupInvite(token: string): Promise<InviteLookup | null> {
    try {
        const res = await fetch(
            `${API_BASE_URL}/api/hackathons/invites/lookup/${encodeURIComponent(token)}`,
            { cache: 'no-store' },
        );
        if (!res.ok) return null;
        return (await res.json()) as InviteLookup;
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
