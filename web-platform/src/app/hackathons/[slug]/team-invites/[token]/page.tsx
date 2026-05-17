/**
 * /hackathons/[slug]/team-invites/[token]
 *
 * Landing page for a teammate clicking a magic-link invite. Renders the
 * hackathon + submission context, the submitter, and asks the user to
 * accept or decline.
 *
 * Auth handling:
 *   - Logged in: render the Accept / Decline buttons (handled client-side).
 *   - Logged out: show an "Open in DevProof" sign-in prompt with the
 *     return URL preserved.
 */

import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';
import { TeamInviteAcceptClient } from '@/components/hackathons/TeamInviteAcceptClient';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

interface InvitePreview {
    hackathon: { id: string; slug: string; name: string };
    submission: {
        id: string;
        tagline: string | null;
        team_name: string | null;
        github_url: string;
    };
    submitter: { user_id: string; username: string | null; name: string | null };
    invited_email: string | null;
    status: 'pending' | 'accepted' | 'declined' | 'revoked';
    expires_at: string;
    is_active: boolean;
}

async function fetchInvite(token: string): Promise<InvitePreview | null> {
    try {
        const fwdHeaders = await buildProxyHeaders({ noContentType: true });
        const res = await fetch(
            `${API_BASE_URL}/api/hackathons/team-invites/lookup/${encodeURIComponent(token)}`,
            { cache: 'no-store', headers: fwdHeaders },
        );
        if (!res.ok) return null;
        return (await res.json()) as InvitePreview;
    } catch {
        return null;
    }
}

export default async function TeamInviteLandingPage({
    params,
}: {
    params: Promise<{ slug: string; token: string }>;
}) {
    const { slug, token } = await params;
    const session = await auth.api.getSession({ headers: await headers() });

    const invite = await fetchInvite(token);
    if (!invite) {
        return (
            <DashboardLayout>
                <NotFound />
            </DashboardLayout>
        );
    }

    // Slug mismatch — token resolved to a different event. Redirect to the
    // correct one rather than 404, since the link was right just on the wrong path.
    if (invite.hackathon.slug !== slug) {
        redirect(`/hackathons/${invite.hackathon.slug}/team-invites/${token}`);
    }

    if (!session?.user) {
        const returnTo = `/hackathons/${slug}/team-invites/${token}`;
        return (
            <DashboardLayout>
                <main className="mx-auto w-full max-w-xl px-6 lg:px-8 py-12">
                    <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: TEXT_DIM, textTransform: 'uppercase', marginBottom: 14 }}>
                        TEAM_INVITE · SIGN_IN
                    </div>
                    <h1 className="font-mono" style={{ fontSize: 22, color: '#EDEDED', marginBottom: 12 }}>
                        ▌Sign in to accept
                    </h1>
                    <p style={{ fontSize: 13, color: '#A1A1A1', lineHeight: 1.6, marginBottom: 20 }}>
                        You&apos;ve been invited to join a team for{' '}
                        <strong style={{ color: '#EDEDED' }}>{invite.hackathon.name}</strong>.
                        Sign in with DevProof to view the project and accept.
                    </p>
                    <Link
                        href={`/?signin=1&return_to=${encodeURIComponent(returnTo)}`}
                        className="inline-block rounded-md px-4 py-2 text-sm font-medium text-white"
                        style={{ backgroundColor: CLAY }}
                    >
                        Sign in with DevProof
                    </Link>
                </main>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <main className="mx-auto w-full max-w-xl px-6 lg:px-8 py-12">
                <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: TEXT_DIM, textTransform: 'uppercase', marginBottom: 14 }}>
                    TEAM_INVITE · {invite.hackathon.name}
                </div>
                <h1 className="font-mono" style={{ fontSize: 22, color: '#EDEDED', marginBottom: 14 }}>
                    ▌You&apos;ve been invited to a team
                </h1>

                {/* Project preview card */}
                <div
                    className="rounded-md border p-5 mb-6 space-y-3"
                    style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                >
                    {invite.submission.team_name && (
                        <div
                            className="font-mono"
                            style={{ fontSize: 10, letterSpacing: '0.12em', color: CLAY, textTransform: 'uppercase' }}
                        >
                            {invite.submission.team_name}
                        </div>
                    )}
                    {invite.submission.tagline && (
                        <p style={{ fontSize: 15, color: '#EDEDED', lineHeight: 1.5 }}>
                            {invite.submission.tagline}
                        </p>
                    )}
                    <p style={{ fontSize: 12, color: TEXT_DIM, fontFamily: 'ui-monospace, monospace' }}>
                        {invite.submission.github_url.replace(/^https?:\/\/github\.com\//, '')}
                    </p>
                    <p style={{ fontSize: 12, color: TEXT_DIM }}>
                        Invited by{' '}
                        <strong style={{ color: '#A1A1A1' }}>
                            @{invite.submitter.username ?? invite.submitter.name ?? '—'}
                        </strong>
                    </p>
                </div>

                {!invite.is_active && (
                    <div
                        className="font-mono mb-6"
                        style={{
                            padding: '12px 14px',
                            border: '1px solid rgba(239,68,68,0.35)',
                            background: 'rgba(239,68,68,0.06)',
                            fontSize: 12,
                            color: '#FCA5A5',
                        }}
                    >
                        This invite is {invite.status} and can no longer be accepted.
                    </div>
                )}

                <p style={{ fontSize: 13, color: '#A1A1A1', lineHeight: 1.6, marginBottom: 18 }}>
                    Accepting gives you full edit rights on this submission and adds
                    the hackathon to your DevProof dashboard.
                </p>

                {invite.is_active ? (
                    <TeamInviteAcceptClient
                        token={token}
                        slug={slug}
                        hackathonName={invite.hackathon.name}
                    />
                ) : (
                    <Link
                        href="/dashboard"
                        className="font-mono text-xs hover:text-foreground"
                        style={{ color: TEXT_DIM, letterSpacing: '0.08em' }}
                    >
                        ← BACK_TO_DASHBOARD
                    </Link>
                )}
            </main>
        </DashboardLayout>
    );
}

function NotFound() {
    return (
        <main className="mx-auto w-full max-w-xl px-6 lg:px-8 py-12">
            <div
                className="font-mono"
                style={{ fontSize: 10, letterSpacing: '0.12em', color: TEXT_DIM, textTransform: 'uppercase', marginBottom: 14 }}
            >
                STATUS · 404 · NOT_FOUND
            </div>
            <h1 className="font-mono" style={{ fontSize: 22, color: '#EDEDED', marginBottom: 12 }}>
                ▌INVITE_NOT_FOUND
            </h1>
            <p style={{ fontSize: 13, color: TEXT_DIM, lineHeight: 1.6 }}>
                We couldn&apos;t find a team invite at this link. It may have been
                revoked, expired, or the URL is mistyped.
            </p>
        </main>
    );
}
