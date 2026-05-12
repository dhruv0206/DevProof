/**
 * /hackathons/[slug]/join — access-code gate.
 *
 * Server component: enforces auth (`auth.api.getSession`). If not authed,
 * renders the standard `<AuthRequiredModal>`. If already a member of the
 * event (your_role !== null), short-circuits with a redirect to /submit
 * (or /me if they've already submitted). Otherwise renders a client form
 * that POSTs the access code.
 *
 * Slug lives in the URL path on purpose — the link the organizer emails
 * looks like `devproof.com/hackathons/hackmit-2026/join`, so users land
 * here pre-routed and only need to paste the code.
 */

import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { AuthRequiredModal } from '@/components/shared/AuthRequiredModal';
import { JoinHackathonForm } from '@/components/hackathons/JoinHackathonForm';

const TEXT_DIM = '#666666';
const CORNER = 'rgba(255,255,255,0.18)';

interface PublicEvent {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    starts_at: string;
    submissions_close_at: string;
    sponsors: { name: string; prize?: string | null }[];
    submission_count: number;
    your_role: 'organizer' | 'judge' | 'participant' | null;
    your_submission_id: string | null;
}

async function fetchEvent(slug: string): Promise<PublicEvent | null> {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    try {
        const res = await fetch(`${API_URL}/api/hackathons/${encodeURIComponent(slug)}`, {
            // Public endpoint — no need to forward cookies for the name.
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return (await res.json()) as PublicEvent;
    } catch {
        return null;
    }
}

export default async function HackathonJoinPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) {
        return (
            <DashboardLayout>
                <AuthRequiredModal
                    title="Sign in to join the hackathon"
                    message="DevProof signs you in with GitHub so we can audit your submission and verify authorship."
                />
            </DashboardLayout>
        );
    }

    const event = await fetchEvent(slug);

    // Already a member — skip the access code step entirely.
    if (event?.your_role === 'organizer' || event?.your_role === 'judge') {
        redirect(`/hackathons/${slug}/admin`);
    }
    if (event?.your_role === 'participant') {
        if (event.your_submission_id) {
            redirect(`/hackathons/${slug}/me`);
        }
        redirect(`/hackathons/${slug}/submit`);
    }

    return (
        <DashboardLayout>
            <main className="mx-auto w-full max-w-xl px-6 lg:px-8 py-12">
                {/* Spec header bar */}
                <div
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        color: TEXT_DIM,
                        textTransform: 'uppercase',
                        marginBottom: 14,
                        display: 'flex',
                        gap: 8,
                    }}
                >
                    <span>HACKATHON</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>JOIN</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'stretch', gap: 14, marginBottom: 18 }}>
                    <div style={{ width: 2, background: '#EDEDED', flexShrink: 0 }} />
                    <h1
                        className="font-mono"
                        style={{
                            fontSize: 24,
                            fontWeight: 500,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                            paddingTop: 2,
                            color: '#EDEDED',
                        }}
                    >
                        ▌{event?.name ?? slug}
                    </h1>
                </div>

                {event ? (
                    <p
                        className="font-mono"
                        style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.65, marginBottom: 22 }}
                    >
                        <span style={{ color: TEXT_DIM }}>// </span>
                        {event.submission_count} submission{event.submission_count === 1 ? '' : 's'} so far
                        <span style={{ opacity: 0.6 }}> · </span>
                        submissions close{' '}
                        <span style={{ color: '#A1A1A1' }}>
                            {new Date(event.submissions_close_at).toLocaleString()}
                        </span>
                    </p>
                ) : (
                    <p
                        className="font-mono"
                        style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.65, marginBottom: 22 }}
                    >
                        <span style={{ color: TEXT_DIM }}>// </span>
                        Event metadata isn&apos;t reachable right now — the access code is still validated server-side.
                    </p>
                )}

                {/* Form card with bracket corners */}
                <div
                    style={{
                        position: 'relative',
                        padding: '28px 24px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.06)',
                    }}
                >
                    <span style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />

                    <JoinHackathonForm
                        slug={slug}
                        eventName={event?.name ?? null}
                        userId={session.user.id}
                    />
                </div>

                {/* Sponsors strip */}
                {event && event.sponsors && event.sponsors.length > 0 && (
                    <div style={{ marginTop: 32 }}>
                        <div
                            className="font-mono"
                            style={{
                                fontSize: 10,
                                letterSpacing: '0.12em',
                                color: TEXT_DIM,
                                textTransform: 'uppercase',
                                marginBottom: 10,
                            }}
                        >
                            SPONSORS <span style={{ opacity: 0.6 }}>·</span>{' '}
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#A1A1A1' }}>
                                {String(event.sponsors.length).padStart(2, '0')}
                            </span>
                        </div>
                        <div className="h-px bg-border" style={{ marginBottom: 12 }} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {event.sponsors.map((s) => (
                                <span
                                    key={s.name}
                                    className="font-mono"
                                    style={{
                                        fontSize: 11,
                                        color: '#EDEDED',
                                        letterSpacing: '0.04em',
                                        padding: '4px 8px',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                    }}
                                >
                                    <span style={{ color: TEXT_DIM }}>[</span>
                                    <span>{s.name}</span>
                                    {s.prize && (
                                        <>
                                            <span style={{ opacity: 0.6, margin: '0 4px' }}>·</span>
                                            <span style={{ color: '#CC785C' }}>{s.prize}</span>
                                        </>
                                    )}
                                    <span style={{ color: TEXT_DIM }}>]</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <div style={{ marginTop: 36 }}>
                    <Link
                        href="/dashboard"
                        className="font-mono text-xs text-muted-foreground hover:text-foreground"
                        style={{ letterSpacing: '0.08em' }}
                    >
                        ← BACK_TO_DASHBOARD
                    </Link>
                </div>
            </main>
        </DashboardLayout>
    );
}
