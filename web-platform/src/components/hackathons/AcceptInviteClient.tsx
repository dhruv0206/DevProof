'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface AcceptInviteClientProps {
    token: string;
    slug: string;
    role: string;
}

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';

/**
 * One-click acceptance UI for a magic-link invite. Calls the FastAPI
 * `POST /api/hackathons/invites/accept/<token>` endpoint via the
 * server-side cookie-forwarding proxy, then redirects to the role's
 * default landing page.
 */
export function AcceptInviteClient({ token, slug, role }: AcceptInviteClientProps) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const handleAccept = () => {
        setError(null);
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons/invites/accept?token=${encodeURIComponent(token)}`,
                    { method: 'POST' },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setError(body?.detail || `Failed to accept invite (HTTP ${res.status})`);
                    return;
                }
                const body = (await res.json()) as { redirect_to?: string };
                const destination = body.redirect_to || `/hackathons/${slug}`;
                router.push(destination);
                router.refresh();
            } catch (e) {
                setError((e as Error).message || 'Network error');
            }
        });
    };

    return (
        <div>
            <button
                type="button"
                onClick={handleAccept}
                disabled={pending}
                className="rounded-md px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: CLAY }}
            >
                {pending ? 'Accepting...' : `Accept invite as ${roleShort(role)}`}
            </button>
            {error && (
                <p className="mt-4 text-sm" style={{ color: '#ef4444' }}>
                    {error}
                </p>
            )}
            <p className="mt-6 text-xs" style={{ color: TEXT_DIM }}>
                Once you accept, this link can't be used again.
            </p>
        </div>
    );
}


function roleShort(role: string): string {
    switch (role) {
        case 'organizer': return 'Organizer';
        case 'judge': return 'Judge';
        case 'observer': return 'Observer';
        default: return role;
    }
}
