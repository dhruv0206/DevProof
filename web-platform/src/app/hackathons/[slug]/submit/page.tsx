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
import { SubmitForm, type SubmitFormInitialValues } from '@/components/hackathons/SubmitForm';
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
    /** Effective lock state from backend — true iff scheduled close has passed
     * OR organizer manually toggled the lock override. */
    submissions_locked?: boolean;
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

interface SubmissionDetailResponse {
    submission_id: string;
    github_url: string;
    extras: Record<string, unknown>;
    team_members: string[];
    tagline?: string | null;
    what_it_does?: string | null;
    demo_url?: string | null;
    team_name?: string | null;
}

async function fetchSubmissionForEdit(
    slug: string,
    submissionId: string,
): Promise<SubmissionDetailResponse | null> {
    try {
        const fwdHeaders = await buildProxyHeaders({ noContentType: true });
        const res = await fetch(
            `${API_BASE_URL}/api/hackathons/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}`,
            { cache: 'no-store', headers: fwdHeaders },
        );
        if (!res.ok) return null;
        return (await res.json()) as SubmissionDetailResponse;
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

    // Existing submission? Switch to EDIT mode with prefilled values instead
    // of redirecting away — the old "redirect to /me" was the loop the user
    // hit when clicking the Edit submission button on /me.
    const isEditMode = !!event.your_submission_id;
    let initialValues: SubmitFormInitialValues | undefined = undefined;
    if (isEditMode) {
        const existing = await fetchSubmissionForEdit(slug, event.your_submission_id!);
        if (existing) {
            initialValues = {
                githubUrl: existing.github_url,
                tagline: existing.tagline ?? '',
                whatItDoes: existing.what_it_does ?? '',
                demoUrl: existing.demo_url ?? '',
                teamName: existing.team_name ?? '',
                teamMembers: existing.team_members ?? [],
                extras: existing.extras ?? {},
                // videoUrl is pulled from extras.demo_video_url by the form itself.
            };
        }
    }

    // Submission window check (UI-side guardrail; backend re-validates).
    // Prefer the authoritative `submissions_locked` flag from backend (which
    // accounts for the organizer's manual override toggle); fall back to a
    // scheduled-close comparison if the backend hasn't updated yet.
    const closesAt = new Date(event.submissions_close_at);
    const closed =
        typeof event.submissions_locked === 'boolean'
            ? event.submissions_locked
            : closesAt.getTime() < Date.now();

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
                    <span>{isEditMode ? 'EDIT' : 'SUBMIT'}</span>
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
                            padding: '14px 16px',
                            border: '1px solid rgba(252,165,165,0.40)',
                            background: 'rgba(239,68,68,0.06)',
                            lineHeight: 1.5,
                            marginBottom: 22,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                        }}
                    >
                        <span style={{ fontSize: 16, marginTop: 1 }}>🔒</span>
                        <div style={{ flex: 1 }}>
                            <div
                                style={{
                                    fontSize: 11,
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                    color: '#fca5a5',
                                    marginBottom: 4,
                                }}
                            >
                                SUBMISSIONS LOCKED · {closesAt.toLocaleString()}
                            </div>
                            <div style={{ fontSize: 12.5, color: '#A1A1A1' }}>
                                {isEditMode
                                    ? 'The window has closed. Your fields are read-only — changes can’t be saved. Ping the organizer if you think this is a mistake.'
                                    : 'New submissions are no longer accepted. Ping the organizer if you think this is a mistake.'}
                            </div>
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
                        submissionId={event.your_submission_id ?? undefined}
                        initialValues={initialValues}
                        locked={closed}
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
