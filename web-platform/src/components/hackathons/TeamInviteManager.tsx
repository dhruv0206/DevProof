'use client';

/**
 * TeamInviteManager — mounted on /hackathons/[slug]/me when the dev has
 * an existing submission. Lets the submitter invite teammates by DevProof
 * username or email, see invite status, and revoke or remove members.
 *
 * Accepted teammates get full edit rights on the submission and the
 * hackathon surfaces on their /me/hackathons dashboard. UI mirrors the
 * organizer-side team management page (same visual grammar).
 */

import { useEffect, useState, useTransition } from 'react';
import { Loader2, X, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';
const BORDER = 'rgba(255,255,255,0.08)';

interface TeamMember {
    id: string;
    submission_id: string;
    invited_user_id: string | null;
    invited_email: string | null;
    accepted_user_id: string | null;
    status: 'pending' | 'accepted' | 'declined' | 'revoked';
    invited_at: string;
    accepted_at: string | null;
    expires_at: string;
    magic_link: string | null;
    accepted_user: {
        user_id: string;
        username: string | null;
        name: string | null;
        email: string | null;
    } | null;
}

interface TeamResponse {
    submission_id: string;
    team_name: string | null;
    submitter: {
        user_id: string;
        username: string | null;
        name: string | null;
        email: string | null;
    };
    members: TeamMember[];
}

interface Props {
    slug: string;
    submissionId: string;
    isSubmitter: boolean;
    submissionsLocked?: boolean;
}

export function TeamInviteManager({
    slug,
    submissionId,
    isSubmitter,
    submissionsLocked,
}: Props) {
    const [team, setTeam] = useState<TeamResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [identifier, setIdentifier] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const refresh = async () => {
        try {
            const res = await fetch(
                `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/team`,
                { cache: 'no-store' },
            );
            if (!res.ok) {
                setError(`Couldn't load team (HTTP ${res.status}).`);
                return;
            }
            const body = (await res.json()) as TeamResponse;
            setTeam(body);
            setError(null);
        } catch {
            setError('Network error loading team.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, submissionId]);

    const handleInvite = (e: React.FormEvent) => {
        e.preventDefault();
        const ident = identifier.trim();
        if (!ident) return;
        setError(null);
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/team/invites`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ identifier: ident }),
                    },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setError(
                        typeof body?.detail === 'string'
                            ? body.detail
                            : `Invite failed (HTTP ${res.status})`,
                    );
                    return;
                }
                setIdentifier('');
                await refresh();
            } catch {
                setError('Network error sending invite.');
            }
        });
    };

    const handleRemove = (inviteId: string, label: string) => {
        if (!confirm(`Remove ${label}? They'll lose edit access immediately.`)) return;
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/team/invites/${encodeURIComponent(inviteId)}`,
                    { method: 'DELETE' },
                );
                if (!res.ok && res.status !== 204) {
                    const body = await res.json().catch(() => ({}));
                    setError(
                        typeof body?.detail === 'string'
                            ? body.detail
                            : `Remove failed (HTTP ${res.status})`,
                    );
                    return;
                }
                await refresh();
            } catch {
                setError('Network error.');
            }
        });
    };

    const copyLink = async (link: string, id: string) => {
        try {
            await navigator.clipboard.writeText(link);
            setCopied(id);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            // clipboard refused — user can manually copy
        }
    };

    if (loading) {
        return (
            <div className="font-mono" style={{ fontSize: 11, color: TEXT_DIM, padding: 16 }}>
                <Loader2 className="inline h-3 w-3 animate-spin mr-2" />
                Loading team…
            </div>
        );
    }

    if (!team) {
        return (
            <div className="font-mono" style={{ fontSize: 11, color: '#FCA5A5', padding: 16 }}>
                {error ?? 'Team unavailable.'}
            </div>
        );
    }

    const accepted = team.members.filter((m) => m.status === 'accepted');
    const pendingInvites = team.members.filter((m) => m.status === 'pending');

    return (
        <div className="rounded-md border p-5 space-y-5" style={{ borderColor: BORDER }}>
            <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: TEXT_DIM, textTransform: 'uppercase' }}>
                ▌TEAM
                {team.team_name && (
                    <span style={{ color: '#A1A1A1', marginLeft: 10, textTransform: 'none', letterSpacing: 'normal' }}>
                        — {team.team_name}
                    </span>
                )}
            </div>

            {/* Submitter row + accepted teammates */}
            <ul className="space-y-2">
                <li
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2 font-mono"
                    style={{ border: `1px solid ${BORDER}`, background: 'rgba(204,120,92,0.04)', fontSize: 12 }}
                >
                    <div className="flex items-baseline gap-2 min-w-0">
                        <span style={{ color: CLAY, letterSpacing: '0.06em', fontSize: 10 }}>SUBMITTER</span>
                        <span style={{ color: '#EDEDED' }}>
                            @{team.submitter.username ?? team.submitter.name ?? 'unknown'}
                        </span>
                        {team.submitter.email && (
                            <span style={{ color: TEXT_DIM, fontSize: 11 }}>{team.submitter.email}</span>
                        )}
                    </div>
                </li>
                {accepted.map((m) => (
                    <li
                        key={m.id}
                        className="flex items-center justify-between gap-3 rounded-md px-3 py-2 font-mono"
                        style={{ border: `1px solid ${BORDER}`, fontSize: 12 }}
                    >
                        <div className="flex items-baseline gap-2 min-w-0 flex-1">
                            <span style={{ color: '#A1A1A1', letterSpacing: '0.06em', fontSize: 10 }}>
                                MEMBER
                            </span>
                            <span style={{ color: '#EDEDED' }}>
                                @{m.accepted_user?.username ?? m.accepted_user?.name ?? '—'}
                            </span>
                            {m.accepted_user?.email && (
                                <span style={{ color: TEXT_DIM, fontSize: 11 }}>{m.accepted_user.email}</span>
                            )}
                        </div>
                        {isSubmitter && (
                            <button
                                type="button"
                                onClick={() =>
                                    handleRemove(m.id, `@${m.accepted_user?.username ?? 'teammate'}`)
                                }
                                disabled={pending}
                                className="text-xs hover:opacity-90"
                                style={{ color: '#ef4444' }}
                            >
                                Remove
                            </button>
                        )}
                    </li>
                ))}
                {pendingInvites.map((m) => (
                    <li
                        key={m.id}
                        className="rounded-md px-3 py-2 font-mono space-y-2"
                        style={{ border: `1px dashed ${BORDER}`, fontSize: 12 }}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-baseline gap-2 min-w-0 flex-1">
                                <span style={{ color: TEXT_DIM, letterSpacing: '0.06em', fontSize: 10 }}>
                                    PENDING
                                </span>
                                <span style={{ color: '#A1A1A1' }}>
                                    {m.invited_email ?? m.invited_user_id ?? '—'}
                                </span>
                            </div>
                            {isSubmitter && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        handleRemove(
                                            m.id,
                                            `invite to ${m.invited_email ?? m.invited_user_id}`,
                                        )
                                    }
                                    disabled={pending}
                                    className="text-xs hover:opacity-90"
                                    style={{ color: '#ef4444' }}
                                >
                                    Revoke
                                </button>
                            )}
                        </div>
                        {m.magic_link && (
                            <div className="flex items-center gap-2">
                                <code
                                    className="flex-1 truncate"
                                    style={{
                                        fontSize: 10,
                                        color: TEXT_DIM,
                                        padding: '4px 6px',
                                        background: 'rgba(255,255,255,0.02)',
                                        border: `1px solid ${BORDER}`,
                                    }}
                                >
                                    {m.magic_link}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => m.magic_link && copyLink(m.magic_link, m.id)}
                                    className="text-xs hover:opacity-90"
                                    style={{ color: copied === m.id ? CLAY : TEXT_DIM }}
                                >
                                    {copied === m.id ? (
                                        <>
                                            <Check className="inline h-3 w-3" /> copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="inline h-3 w-3" /> copy
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>

            {/* Invite form */}
            {isSubmitter && !submissionsLocked && (
                <form onSubmit={handleInvite} className="space-y-2">
                    <label
                        className="font-mono block"
                        style={{ fontSize: 10, letterSpacing: '0.12em', color: TEXT_DIM, textTransform: 'uppercase' }}
                    >
                        INVITE_TEAMMATE
                        <span style={{ opacity: 0.6, marginLeft: 6 }}>·</span>
                        <span style={{ color: '#A1A1A1', marginLeft: 6, textTransform: 'none', letterSpacing: 'normal' }}>
                            DevProof username OR email
                        </span>
                    </label>
                    <div className="flex gap-2">
                        <Input
                            type="text"
                            placeholder="@alex-chen or alex@example.com"
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            disabled={pending}
                            className="font-mono flex-1"
                        />
                        <Button type="submit" disabled={pending || !identifier.trim()} size="default">
                            {pending ? 'Sending…' : 'Invite'}
                        </Button>
                    </div>
                </form>
            )}

            {submissionsLocked && isSubmitter && (
                <p
                    className="font-mono"
                    style={{
                        fontSize: 11,
                        color: TEXT_DIM,
                        lineHeight: 1.5,
                        padding: '8px 10px',
                        border: `1px solid ${BORDER}`,
                    }}
                >
                    <span style={{ color: TEXT_DIM }}>// </span>
                    Submissions are locked — team can no longer change for this event.
                </p>
            )}

            {error && (
                <p
                    className="font-mono"
                    style={{
                        fontSize: 11,
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
