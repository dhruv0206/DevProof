/**
 * /hackathons/[slug]/submit — project submission form.
 *
 * Server component: enforces auth + participant role. We forward the user's
 * BetterAuth cookie when calling `GET /api/hackathons/{slug}` so the
 * backend can populate `your_role` correctly. Non-participants get bounced
 * back to /join.
 *
 * If the user has already submitted (`your_submission_id` is non-null) we
 * redirect to /me with no banner — the same form is reachable from there
 * via "Edit submission".
 */

import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { AuthRequiredModal } from '@/components/shared/AuthRequiredModal';
import { SubmitForm } from '@/components/hackathons/SubmitForm';
import { API_BASE_URL, buildProxyHeaders } from '@/lib/internal-proxy';

const TEXT_DIM = '#666666';
const CORNER = 'rgba(255,255,255,0.18)';

interface AuthedEvent {
    id: string;
    slug: string;
    name: string;
    submissions_close_at: string;
    sponsors: { name: string; prize?: string | null }[];
    rules_text?: string | null;
    your_role: 'organizer' | 'judge' | 'participant' | null;
    your_submission_id: string | null;
    // settings is documented public on the event response too; defensive default below.
    settings?: {
        extras_required?: string[];
        extras_optional?: string[];
        max_team_size?: number | null;
        rules_text?: string | null;
    };
}

async function fetchEventForUser(slug: string, _userId: string | null): Promise<AuthedEvent | null> {
    try {
        const fwdHeaders = await buildProxyHeaders({ noContentType: true });
        const res = await fetch(`${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}`, {
            cache: 'no-store',
            headers: fwdHeaders,
        });
        if (!res.ok) return null;
        return (await res.json()) as AuthedEvent;
    } catch {
        return null;
    }
}

export default async function HackathonSubmitPage({
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
                    title="Sign in to submit"
                    message="DevProof signs you in with GitHub so we can audit your submission and verify authorship."
                />
            </DashboardLayout>
        );
    }

    const event = await fetchEventForUser(slug, session.user.id);

    if (!event) {
        return (
            <DashboardLayout>
                <main className="mx-auto w-full max-w-xl px-6 lg:px-8 py-12">
                    <div
                        className="font-mono"
                        style={{ fontSize: 10, letterSpacing: '0.12em', color: TEXT_DIM, textTransform: 'uppercase', marginBottom: 14 }}
                    >
                        STATUS · 404 · NOT_FOUND
                    </div>
                    <h1
                        className="font-mono"
                        style={{ fontSize: 22, letterSpacing: '0.02em', textTransform: 'uppercase', color: '#EDEDED', marginBottom: 16 }}
                    >
                        ▌HACKATHON_NOT_FOUND
                    </h1>
                    <p className="font-mono" style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.65 }}>
                        <span style={{ color: TEXT_DIM }}>// </span>
                        We couldn&apos;t find a hackathon at <code>/{slug}</code>. Double-check the link from the
                        organizer.
                    </p>
                </main>
            </DashboardLayout>
        );
    }

    // Organizers and judges have an admin dashboard, not a submission form.
    if (event.your_role === 'organizer' || event.your_role === 'judge') {
        redirect(`/hackathons/${slug}/admin`);
    }
    // No role at all — they need to join first.
    if (event.your_role !== 'participant') {
        redirect(`/hackathons/${slug}/join`);
    }

    // Already submitted — go view it.
    if (event.your_submission_id) {
        redirect(`/hackathons/${slug}/me`);
    }

    // Submission window check (UI-side guardrail; backend re-validates).
    const closesAt = new Date(event.submissions_close_at);
    const closed = closesAt.getTime() < Date.now();

    const settings = event.settings ?? {};
    const extrasRequired = settings.extras_required ?? [];
    const extrasOptional = settings.extras_optional ?? [];
    const maxTeamSize = settings.max_team_size ?? null;

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
                        display: 'flex',
                        gap: 8,
                    }}
                >
                    <span>HACKATHON</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>SUBMIT</span>
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
                        marginBottom: 22,
                    }}
                >
                    <span>SUBMITTING_AS</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span style={{ color: '#A1A1A1' }}>@{session.user.name}</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>
                        CLOSES{' '}
                        <span style={{ color: closed ? '#FCA5A5' : '#A1A1A1' }}>
                            {closesAt.toLocaleString()}
                        </span>
                    </span>
                </div>

                {closed && (
                    <div
                        className="font-mono"
                        style={{
                            padding: '12px 14px',
                            border: '1px solid rgba(239,68,68,0.35)',
                            background: 'rgba(239,68,68,0.06)',
                            fontSize: 12,
                            color: '#FCA5A5',
                            lineHeight: 1.5,
                            marginBottom: 22,
                        }}
                    >
                        <div
                            style={{
                                fontSize: 10,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                marginBottom: 4,
                            }}
                        >
                            CLOSED · SUBMISSIONS_LOCKED
                        </div>
                        <div>
                            The submission window has closed. New submissions are no longer accepted —
                            ping the organizer if you think this is wrong.
                        </div>
                    </div>
                )}

                {/* Form card with bracket corners */}
                <div
                    style={{
                        position: 'relative',
                        padding: '32px 28px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.06)',
                    }}
                >
                    <span style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />

                    <SubmitForm
                        slug={slug}
                        extrasRequired={extrasRequired}
                        extrasOptional={extrasOptional}
                        maxTeamSize={maxTeamSize}
                        userId={session.user.id}
                    />
                </div>

                {event.rules_text || settings.rules_text ? (
                    <div style={{ marginTop: 36 }}>
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
                            RULES
                        </div>
                        <div className="h-px bg-border" style={{ marginBottom: 12 }} />
                        <p
                            className="font-sans"
                            style={{ fontSize: 13, color: '#A1A1A1', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}
                        >
                            {event.rules_text ?? settings.rules_text}
                        </p>
                    </div>
                ) : null}

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
