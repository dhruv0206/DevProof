'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { InviteSummary, TeamMember } from '@/lib/hackathons';

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';
const BORDER = 'rgba(255,255,255,0.08)';
const SURFACE_HOVER = 'rgba(255,255,255,0.02)';

interface Props {
    slug: string;
    initialTeam: TeamMember[];
    initialInvites: InviteSummary[];
}

type RoleOption = 'organizer' | 'judge' | 'observer';

const ROLE_DESCRIPTIONS: Record<RoleOption, string> = {
    organizer: 'Full event admin — settings, awards, team management',
    judge: 'Score submissions, see leaderboard',
    observer: 'Read-only — sponsor visibility',
};

export function TeamManagementClient({ slug, initialTeam, initialInvites }: Props) {
    const router = useRouter();
    const [team, setTeam] = useState<TeamMember[]>(initialTeam);
    const [invites, setInvites] = useState<InviteSummary[]>(initialInvites);
    const [pending, startTransition] = useTransition();

    // Invite form state
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<RoleOption>('judge');
    const [expiresInDays, setExpiresInDays] = useState(7);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [lastCreatedLink, setLastCreatedLink] = useState<string | null>(null);

    const handleCreateInvite = (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setLastCreatedLink(null);
        startTransition(async () => {
            try {
                const res = await fetch(`/api/hackathons-proxy/${slug}/invites`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        invited_email: email.trim() || null,
                        role,
                        expires_in_days: expiresInDays,
                    }),
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setErrorMsg(
                        typeof body?.detail === 'string'
                            ? body.detail
                            : `Failed (HTTP ${res.status})`,
                    );
                    return;
                }
                const newInvite = (await res.json()) as InviteSummary;
                setInvites([newInvite, ...invites]);
                setLastCreatedLink(newInvite.magic_link);
                setEmail('');
            } catch (err) {
                setErrorMsg((err as Error).message || 'Network error');
            }
        });
    };

    const handleRevoke = (invite: InviteSummary) => {
        if (!confirm(`Revoke invite to ${invite.invited_email || '(no email)'}?`)) return;
        startTransition(async () => {
            const res = await fetch(
                `/api/hackathons-proxy/${slug}/invites/${invite.id}`,
                { method: 'DELETE' },
            );
            if (res.ok) {
                setInvites(invites.map((i) =>
                    i.id === invite.id
                        ? { ...i, revoked_at: new Date().toISOString(), status: 'revoked' as const }
                        : i,
                ));
            } else {
                alert('Failed to revoke invite');
            }
        });
    };

    const handleRemoveMember = (member: TeamMember) => {
        const label = member.username || member.email || member.user_id;
        if (!confirm(`Remove ${label} from the team?`)) return;
        startTransition(async () => {
            const res = await fetch(
                `/api/hackathons-proxy/${slug}/team/${encodeURIComponent(member.user_id)}`,
                { method: 'DELETE' },
            );
            if (res.ok) {
                setTeam(team.filter((m) => m.user_id !== member.user_id));
            } else {
                const body = await res.json().catch(() => ({}));
                alert(`Failed to remove: ${body?.detail || res.status}`);
            }
        });
    };

    const handleChangeRole = (member: TeamMember, newRole: RoleOption) => {
        if (newRole === member.role) return;
        startTransition(async () => {
            const res = await fetch(
                `/api/hackathons-proxy/${slug}/team/${encodeURIComponent(member.user_id)}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: newRole }),
                },
            );
            if (res.ok) {
                setTeam(team.map((m) =>
                    m.user_id === member.user_id
                        ? { ...m, role: newRole }
                        : m,
                ));
            } else {
                const body = await res.json().catch(() => ({}));
                alert(`Failed to change role: ${body?.detail || res.status}`);
            }
        });
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(
            () => { /* silent success */ },
            () => alert('Copy failed — your browser blocked clipboard access'),
        );
    };

    return (
        <div className="space-y-12">
            {/* ─── Invite form ─── */}
            <section>
                <h2 className="text-lg font-medium mb-1">Invite a team member</h2>
                <p className="text-xs mb-4" style={{ color: TEXT_DIM }}>
                    Generates a one-time magic link you can copy and send. Link expires in
                    7 days by default.
                </p>

                <form
                    onSubmit={handleCreateInvite}
                    className="rounded-lg border p-5 space-y-4"
                    style={{ borderColor: BORDER }}
                >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs uppercase tracking-wider mb-2"
                                style={{ color: TEXT_DIM }}>
                                Email (optional)
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="elsa@fomo.club"
                                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1"
                                style={{
                                    borderColor: BORDER,
                                }}
                            />
                        </div>
                        <div>
                            <label className="block text-xs uppercase tracking-wider mb-2"
                                style={{ color: TEXT_DIM }}>
                                Role
                            </label>
                            <select
                                value={role}
                                onChange={(e) => setRole(e.target.value as RoleOption)}
                                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1"
                                style={{ borderColor: BORDER }}
                            >
                                <option value="organizer">Organizer</option>
                                <option value="judge">Judge</option>
                                <option value="observer">Observer</option>
                            </select>
                            <p className="mt-1 text-xs" style={{ color: TEXT_DIM }}>
                                {ROLE_DESCRIPTIONS[role]}
                            </p>
                        </div>
                        <div>
                            <label className="block text-xs uppercase tracking-wider mb-2"
                                style={{ color: TEXT_DIM }}>
                                Expires in
                            </label>
                            <select
                                value={expiresInDays}
                                onChange={(e) => setExpiresInDays(Number(e.target.value))}
                                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1"
                                style={{ borderColor: BORDER }}
                            >
                                <option value={1}>1 day</option>
                                <option value={3}>3 days</option>
                                <option value={7}>7 days</option>
                                <option value={14}>14 days</option>
                                <option value={30}>30 days</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={pending}
                            className="rounded-md px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: CLAY }}
                        >
                            {pending ? 'Creating...' : 'Generate magic link'}
                        </button>
                    </div>
                    {errorMsg && (
                        <p className="text-sm" style={{ color: '#ef4444' }}>{errorMsg}</p>
                    )}
                    {lastCreatedLink && (
                        <div
                            className="rounded-md p-3 text-xs"
                            style={{ backgroundColor: 'rgba(34,197,94,0.08)', color: '#22c55e' }}
                        >
                            <p className="font-medium mb-2">
                                ✓ Invite created. Copy this link and send it:
                            </p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 break-all p-2 rounded bg-black/20">
                                    {lastCreatedLink}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(lastCreatedLink)}
                                    className="rounded px-3 py-2 text-xs font-medium"
                                    style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                                >
                                    Copy
                                </button>
                            </div>
                        </div>
                    )}
                </form>
            </section>

            {/* ─── Current team ─── */}
            <section>
                <h2 className="text-lg font-medium mb-4">Current team ({team.length})</h2>
                {team.length === 0 ? (
                    <p className="text-sm" style={{ color: TEXT_DIM }}>
                        No team members yet.
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {team.map((m) => (
                            <li
                                key={m.user_id}
                                className="flex items-center justify-between rounded-lg border p-4"
                                style={{ borderColor: BORDER }}
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">
                                        {m.name || m.username || '(no name)'}
                                    </p>
                                    <p className="text-xs truncate" style={{ color: TEXT_DIM }}>
                                        {m.email || m.username || m.user_id} · Joined {formatRelativeDate(m.joined_at)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 ml-4">
                                    <select
                                        value={m.role}
                                        onChange={(e) => handleChangeRole(m, e.target.value as RoleOption)}
                                        disabled={pending}
                                        className="rounded-md border bg-transparent px-2 py-1 text-xs"
                                        style={{ borderColor: BORDER }}
                                    >
                                        <option value="organizer">Organizer</option>
                                        <option value="judge">Judge</option>
                                        <option value="observer">Observer</option>
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveMember(m)}
                                        disabled={pending}
                                        className="rounded-md px-2 py-1 text-xs font-medium transition-colors"
                                        style={{ color: '#ef4444' }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* ─── Invites ─── */}
            <section>
                <h2 className="text-lg font-medium mb-4">Invites</h2>
                {invites.length === 0 ? (
                    <p className="text-sm" style={{ color: TEXT_DIM }}>
                        No invites yet.
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {invites.map((i) => (
                            <li
                                key={i.id}
                                className="flex items-center justify-between rounded-lg border p-4"
                                style={{ borderColor: BORDER }}
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm">
                                        <span className="font-medium">{i.invited_email || '(no email)'}</span>
                                        {' '}
                                        <span className="text-xs ml-2" style={{ color: TEXT_DIM }}>
                                            · {i.role} · {i.status}
                                        </span>
                                    </p>
                                    <p className="text-xs mt-1 truncate" style={{ color: TEXT_DIM }}>
                                        Expires {formatRelativeDate(i.expires_at)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 ml-4">
                                    {i.status === 'pending' && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => copyToClipboard(i.magic_link)}
                                                className="rounded-md px-3 py-1 text-xs font-medium"
                                                style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                                            >
                                                Copy link
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRevoke(i)}
                                                disabled={pending}
                                                className="rounded-md px-3 py-1 text-xs font-medium"
                                                style={{ color: '#ef4444' }}
                                            >
                                                Revoke
                                            </button>
                                        </>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}


function formatRelativeDate(iso: string): string {
    const d = new Date(iso);
    const now = Date.now();
    const diff = d.getTime() - now;
    const absDays = Math.abs(diff / (1000 * 60 * 60 * 24));
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (absDays < 1) return rtf.format(Math.round(diff / (1000 * 60 * 60)), 'hour');
    if (absDays < 60) return rtf.format(Math.round(diff / (1000 * 60 * 60 * 24)), 'day');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
