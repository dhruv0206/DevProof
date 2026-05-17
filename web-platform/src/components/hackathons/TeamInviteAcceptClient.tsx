'use client';

/**
 * TeamInviteAcceptClient — accept/decline buttons for a team invite.
 *
 * On accept: server creates the team_member binding + a participant role,
 * then we redirect the user to /me where they'll see the submission and
 * can edit it.
 *
 * On decline: marks the invite declined and shows a confirmation.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TEXT_DIM = '#666666';

interface Props {
    token: string;
    slug: string;
    hackathonName: string;
}

export function TeamInviteAcceptClient({ token, slug }: Props) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [declinedNotice, setDeclinedNotice] = useState(false);
    const router = useRouter();

    const handleAccept = () => {
        setError(null);
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/team-invites/${encodeURIComponent(token)}/accept`,
                    { method: 'POST' },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setError(
                        typeof body?.detail === 'string'
                            ? body.detail
                            : `Accept failed (HTTP ${res.status}).`,
                    );
                    return;
                }
                router.push(`/hackathons/${slug}/me`);
            } catch {
                setError('Network error. Try again in a moment.');
            }
        });
    };

    const handleDecline = () => {
        if (!confirm('Decline this team invite? You can be re-invited later.')) return;
        setError(null);
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/team-invites/${encodeURIComponent(token)}/decline`,
                    { method: 'POST' },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setError(
                        typeof body?.detail === 'string'
                            ? body.detail
                            : `Decline failed (HTTP ${res.status}).`,
                    );
                    return;
                }
                setDeclinedNotice(true);
            } catch {
                setError('Network error.');
            }
        });
    };

    if (declinedNotice) {
        return (
            <div
                className="font-mono"
                style={{
                    padding: '12px 14px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: 12,
                    color: TEXT_DIM,
                }}
            >
                Invite declined. You can close this tab.
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex gap-3">
                <Button onClick={handleAccept} disabled={pending} className="gap-2">
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Accept invite
                </Button>
                <Button
                    onClick={handleDecline}
                    disabled={pending}
                    variant="outline"
                >
                    Decline
                </Button>
            </div>
            {error && (
                <p
                    className="font-mono"
                    style={{
                        fontSize: 12,
                        color: '#FCA5A5',
                        padding: '8px 10px',
                        border: '1px solid rgba(239,68,68,0.35)',
                        background: 'rgba(239,68,68,0.06)',
                    }}
                >
                    {error}
                </p>
            )}
        </div>
    );
}
