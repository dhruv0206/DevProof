/**
 * /hackathons/[slug]/me — own submission view.
 *
 * Server component: enforces auth, looks up the user's submission via
 * `your_submission_id` on `GET /api/hackathons/{slug}`. If they don't have
 * one yet, bounces to /submit (or /join if they're not even a participant
 * yet).
 *
 * The polling and dynamic state live in <SubmissionStatusPanel>.
 */

import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { AuthRequiredModal } from '@/components/shared/AuthRequiredModal';
import { SubmissionStatusPanel } from '@/components/hackathons/SubmissionStatusPanel';

const TEXT_DIM = '#666666';

interface AuthedEvent {
    id: string;
    slug: string;
    name: string;
    submissions_close_at: string;
    your_role: 'organizer' | 'judge' | 'participant' | null;
    your_submission_id: string | null;
}

async function fetchEventForUser(slug: string, userId: string | null): Promise<AuthedEvent | null> {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    try {
        const res = await fetch(`${API_URL}/api/hackathons/${encodeURIComponent(slug)}`, {
            cache: 'no-store',
            headers: userId ? { 'X-User-Id': userId } : undefined,
        });
        if (!res.ok) return null;
        return (await res.json()) as AuthedEvent;
    } catch {
        return null;
    }
}

export default async function HackathonMePage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });

    if (!session?.user) {
        return (
            <DashboardLayout>
                <AuthRequiredModal
                    title="Sign in to view your submission"
                    message="You'll be redirected back to your hackathon submission once you're signed in."
                />
            </DashboardLayout>
        );
    }

    const event = await fetchEventForUser(slug, session.user.id);

    if (!event) {
        return (
            <DashboardLayout>
                <main className="mx-auto w-full max-w-2xl px-6 lg:px-8 py-12">
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            color: TEXT_DIM,
                            textTransform: 'uppercase',
                            marginBottom: 14,
                        }}
                    >
                        STATUS · 404 · NOT_FOUND
                    </div>
                    <h1
                        className="font-mono"
                        style={{
                            fontSize: 22,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                            color: '#EDEDED',
                            marginBottom: 16,
                        }}
                    >
                        ▌HACKATHON_NOT_FOUND
                    </h1>
                    <p className="font-mono" style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.65 }}>
                        <span style={{ color: TEXT_DIM }}>// </span>
                        We couldn&apos;t find a hackathon at <code>/{slug}</code>.
                    </p>
                </main>
            </DashboardLayout>
        );
    }

    if (!event.your_role) {
        redirect(`/hackathons/${slug}/join`);
    }

    if (!event.your_submission_id) {
        redirect(`/hackathons/${slug}/submit`);
    }

    const closesAt = new Date(event.submissions_close_at);
    const canEdit = closesAt.getTime() > Date.now();

    return (
        <DashboardLayout>
            <main className="mx-auto w-full max-w-3xl px-6 lg:px-8 py-12">
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
                    <span>MY_SUBMISSION</span>
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
                        ▌{event.name}
                    </h1>
                </div>

                <div
                    className="font-mono"
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'baseline',
                        gap: 10,
                        fontSize: 12,
                        color: TEXT_DIM,
                        marginBottom: 28,
                    }}
                >
                    <span>SUBMITTER</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span style={{ color: '#A1A1A1' }}>@{session.user.name}</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>{canEdit ? 'WINDOW_OPEN' : 'WINDOW_CLOSED'}</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span style={{ color: '#A1A1A1' }}>{closesAt.toLocaleString()}</span>
                </div>

                <SubmissionStatusPanel
                    slug={slug}
                    submissionId={event.your_submission_id!}
                    canEdit={canEdit}
                    userId={session.user.id}
                />

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
