'use client';

/**
 * Polling status surface for /hackathons/[slug]/me.
 *
 * - Polls `GET /api/hackathons/{slug}/submissions/{submission_id}` every
 *   15s while audit_status is pending or running.
 * - Stops polling on `complete` or `failed`. Hard cap at 20 minutes mirrors
 *   the AddProjectModal pattern.
 * - On complete: renders <HackathonScoreCard>.
 * - On failed: shows the error + a "Retry audit" button that PATCHes the
 *   submission with the same github_url to retrigger the audit (backend
 *   re-triggers when github_url changes; we no-op-equivalent by sending
 *   the same URL — backend should handle this idempotently. Open contract
 *   question logged below).
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Pin, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HackathonScoreCard } from './HackathonScoreCard';
import {
    SubmissionStatusBadge,
    type AuditStatus,
} from './SubmissionStatusBadge';

const TEXT_DIM = '#666666';
const CORNER = 'rgba(255,255,255,0.18)';

interface SubmissionDetail {
    submission_id: string;
    github_url: string;
    extras: Record<string, unknown>;
    team_members: string[];
    submission_status: 'draft' | 'submitted' | 'withdrawn';
    audit_status: AuditStatus;
    audit_error: string | null;
    repo_score: number | null;
    repo_tier: string | null;
    matched_sponsors: Record<string, number> | null;
    v4_output_url: string | null;
    submitted_at: string;
    deep_analysis_seconds: number | null;
    /** True iff the score number itself is visible. False = hide-until-publish mode. */
    score_visible?: boolean;
    score_hidden_reason?: string | null;
    pinned_to_profile?: boolean;
}

const POLL_INTERVAL_MS = 15_000;
const HARD_CAP_MS = 20 * 60 * 1000;

export function SubmissionStatusPanel({
    slug,
    submissionId,
    canEdit,
    userId,
}: {
    slug: string;
    submissionId: string;
    canEdit: boolean;
    userId: string;
}) {
    const [detail, setDetail] = useState<SubmissionDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const startedAtRef = useRef<number>(Date.now());
    const [retrying, setRetrying] = useState(false);

    const fetchOnce = async () => {
        try {
            // Goes through the Next proxy so the internal-proxy secret + session
            // user-id are injected server-side (client can't carry the secret).
            const res = await fetch(
                `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}`,
            );
            if (!res.ok) {
                setError(`Could not load submission (status ${res.status}).`);
                return;
            }
            const body = (await res.json()) as SubmissionDetail;
            setDetail(body);
            setError(null);

            // Stop polling on terminal states.
            if (body.audit_status === 'complete' || body.audit_status === 'failed') {
                if (pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                }
            }

            // Hard cap — flip to failed if we've been waiting absurdly long.
            if (Date.now() - startedAtRef.current > HARD_CAP_MS && body.audit_status !== 'complete') {
                if (pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                }
            }
        } catch {
            // Swallow — next tick retries. The fetch is cheap.
        }
    };

    useEffect(() => {
        startedAtRef.current = Date.now();
        fetchOnce();
        pollRef.current = setInterval(fetchOnce, POLL_INTERVAL_MS);
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, submissionId]);

    const handleRetry = async () => {
        if (!detail || retrying) return;
        setRetrying(true);
        try {
            const res = await fetch(
                `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ github_url: detail.github_url }),
                },
            );
            if (res.ok) {
                // Re-arm polling.
                startedAtRef.current = Date.now();
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = setInterval(fetchOnce, POLL_INTERVAL_MS);
                fetchOnce();
            } else {
                setError(`Retry failed (status ${res.status}).`);
            }
        } catch {
            setError('Network error during retry.');
        } finally {
            setRetrying(false);
        }
    };

    if (!detail && !error) {
        return (
            <div
                className="flex items-center justify-center py-16 font-mono"
                style={{ fontSize: 11, color: TEXT_DIM, letterSpacing: '0.08em' }}
            >
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                LOADING_SUBMISSION
            </div>
        );
    }

    if (error && !detail) {
        return (
            <div
                className="font-mono"
                style={{
                    padding: '14px 16px',
                    border: '1px solid rgba(239,68,68,0.35)',
                    background: 'rgba(239,68,68,0.06)',
                    fontSize: 12,
                    color: '#FCA5A5',
                    lineHeight: 1.5,
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
                    ERROR
                </div>
                <div>{error}</div>
            </div>
        );
    }

    if (!detail) return null;

    const isTerminal = detail.audit_status === 'complete' || detail.audit_status === 'failed';
    const shortRepo = detail.github_url.replace('https://github.com/', '');

    return (
        <div className="space-y-8">
            {/* Header strip — status + meta */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <SubmissionStatusBadge status={detail.audit_status} />
                <div
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        color: TEXT_DIM,
                        textTransform: 'uppercase',
                    }}
                >
                    SUBMITTED · {new Date(detail.submitted_at).toISOString().slice(0, 16).replace('T', ' ')}Z
                </div>
            </div>

            {/* Submission detail block */}
            <div
                style={{
                    position: 'relative',
                    padding: '24px 26px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                }}
            >
                <span style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                <span style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />

                <div
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        color: TEXT_DIM,
                        textTransform: 'uppercase',
                        marginBottom: 8,
                    }}
                >
                    GITHUB_URL
                </div>
                <a
                    href={detail.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono hover:text-primary"
                    style={{
                        fontSize: 13,
                        color: '#EDEDED',
                        wordBreak: 'break-all',
                        display: 'inline-flex',
                        alignItems: 'baseline',
                        gap: 6,
                    }}
                >
                    {shortRepo}
                    <ExternalLink className="h-3 w-3" />
                </a>

                {detail.team_members.length > 0 && (
                    <>
                        <div className="h-px bg-border" style={{ margin: '16px 0' }} />
                        <div
                            className="font-mono"
                            style={{
                                fontSize: 10,
                                letterSpacing: '0.12em',
                                color: TEXT_DIM,
                                textTransform: 'uppercase',
                                marginBottom: 8,
                            }}
                        >
                            TEAM <span style={{ opacity: 0.6 }}>·</span>{' '}
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#A1A1A1' }}>
                                {String(detail.team_members.length).padStart(2, '0')}
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {detail.team_members.map((name) => (
                                <span
                                    key={name}
                                    className="font-mono"
                                    style={{
                                        fontSize: 11,
                                        color: '#EDEDED',
                                        letterSpacing: '0.04em',
                                        padding: '4px 8px',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                    }}
                                >
                                    <span style={{ color: TEXT_DIM }}>@</span>
                                    {name}
                                </span>
                            ))}
                        </div>
                    </>
                )}

                {Object.keys(detail.extras).length > 0 && (
                    <>
                        <div className="h-px bg-border" style={{ margin: '16px 0' }} />
                        <div
                            className="font-mono"
                            style={{
                                fontSize: 10,
                                letterSpacing: '0.12em',
                                color: TEXT_DIM,
                                textTransform: 'uppercase',
                                marginBottom: 8,
                            }}
                        >
                            EXTRAS
                        </div>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {Object.entries(detail.extras).map(([k, v]) => (
                                <li
                                    key={k}
                                    className="font-mono"
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '180px 1fr',
                                        gap: 12,
                                        padding: '6px 0',
                                        borderBottom: '1px solid var(--border)',
                                        fontSize: 11,
                                    }}
                                >
                                    <span
                                        style={{
                                            color: TEXT_DIM,
                                            letterSpacing: '0.06em',
                                            textTransform: 'uppercase',
                                        }}
                                    >
                                        {k}
                                    </span>
                                    <ExtraValue value={v} />
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>

            {/* Audit-state body */}
            {detail.audit_status === 'pending' || detail.audit_status === 'running' ? (
                <div
                    className="font-mono"
                    style={{
                        position: 'relative',
                        padding: '32px 26px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        textAlign: 'center',
                    }}
                >
                    <span style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />

                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-4 text-primary" />
                    <div
                        style={{
                            fontSize: 12,
                            color: '#EDEDED',
                            letterSpacing: '0.04em',
                            marginBottom: 6,
                        }}
                    >
                        DEEP_ANALYSIS_RUNNING
                    </div>
                    <div
                        style={{
                            fontSize: 11,
                            color: TEXT_DIM,
                            lineHeight: 1.6,
                            maxWidth: 480,
                            margin: '0 auto',
                        }}
                    >
                        <span style={{ color: TEXT_DIM }}>// </span>
                        V4 pipeline auditing your repo — graph analysis, pattern detection, semantic chunking.
                        Usually 1–15 min. You can close this tab and come back.
                    </div>
                    <div
                        style={{
                            marginTop: 14,
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                        }}
                    >
                        POLLING · EVERY_15S
                    </div>
                </div>
            ) : detail.audit_status === 'failed' ? (
                <div
                    className="font-mono"
                    style={{
                        padding: '24px 26px',
                        background: 'rgba(239,68,68,0.04)',
                        border: '1px solid rgba(239,68,68,0.25)',
                    }}
                >
                    <div
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: '#FCA5A5',
                            marginBottom: 8,
                        }}
                    >
                        AUDIT · FAILED
                    </div>
                    <p
                        style={{
                            fontSize: 12,
                            color: '#FCA5A5',
                            lineHeight: 1.6,
                            marginBottom: 14,
                        }}
                    >
                        {detail.audit_error
                            ? detail.audit_error
                            : 'The deep analysis didn’t complete. Most often this means the repo is private, authorship is too low, or the pipeline hit a transient error.'}
                    </p>
                    <Button onClick={handleRetry} disabled={retrying} variant="outline" className="gap-2">
                        {retrying ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="h-4 w-4" />
                        )}
                        Retry audit
                    </Button>
                </div>
            ) : detail.audit_status === 'complete' && detail.score_visible === false ? (
                <HiddenScoreNotice
                    deepAnalysisSeconds={detail.deep_analysis_seconds}
                    reason={detail.score_hidden_reason}
                />
            ) : detail.repo_score !== null ? (
                <>
                    <HackathonScoreCard
                        repoScore={detail.repo_score}
                        repoTier={detail.repo_tier}
                        matchedSponsors={detail.matched_sponsors}
                        deepAnalysisSeconds={detail.deep_analysis_seconds}
                        githubUrl={detail.github_url}
                        submittedAt={detail.submitted_at}
                    />
                    <PinToProfileToggle
                        slug={slug}
                        submissionId={submissionId}
                        userId={userId}
                        initialPinned={detail.pinned_to_profile ?? false}
                    />
                </>
            ) : null}

            {/* Edit submission CTA */}
            {canEdit && isTerminal && (
                <div className="flex justify-end">
                    <Link
                        href={`/hackathons/${slug}/submit`}
                        className="font-mono text-xs hover:text-foreground"
                        style={{
                            color: TEXT_DIM,
                            letterSpacing: '0.08em',
                            padding: '8px 14px',
                            border: '1px solid rgba(255,255,255,0.08)',
                        }}
                    >
                        EDIT_SUBMISSION →
                    </Link>
                </div>
            )}
        </div>
    );
}

function HiddenScoreNotice({
    deepAnalysisSeconds,
    reason,
}: {
    deepAnalysisSeconds: number | null;
    reason: string | null | undefined;
}) {
    const reasonText =
        reason === 'leaderboard_not_published'
            ? 'The organizer hasn’t published the leaderboard yet.'
            : 'Score is hidden for now.';
    const elapsed = deepAnalysisSeconds
        ? `${(deepAnalysisSeconds / 60).toFixed(1)} min`
        : null;
    return (
        <div
            className="font-mono"
            style={{
                position: 'relative',
                padding: '32px 26px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            <span style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
            <div
                style={{
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#22c55e',
                    marginBottom: 10,
                }}
            >
                AUDIT · PASSED
            </div>
            <div style={{ fontSize: 14, color: '#EDEDED', marginBottom: 10 }}>
                Submission audited successfully.
            </div>
            <div
                style={{
                    fontSize: 12,
                    color: TEXT_DIM,
                    lineHeight: 1.65,
                    maxWidth: 520,
                }}
            >
                <span style={{ color: TEXT_DIM }}>// </span>
                {reasonText} Your score, tier, and sponsor matches are revealed
                when the leaderboard goes public.
                {elapsed ? (
                    <>
                        {' '}Deep analysis ran in <span style={{ color: '#A1A1A1' }}>{elapsed}</span>.
                    </>
                ) : null}
            </div>
        </div>
    );
}

function PinToProfileToggle({
    slug,
    submissionId,
    userId,
    initialPinned,
}: {
    slug: string;
    submissionId: string;
    userId: string;
    initialPinned: boolean;
}) {
    const [pinned, setPinned] = useState(initialPinned);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const toggle = async () => {
        if (busy) return;
        setBusy(true);
        setErr(null);
        const next = !pinned;
        try {
            const res = await fetch(
                `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/pin`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pinned: next }),
                },
            );
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.detail || `HTTP ${res.status}`);
            }
            setPinned(next);
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Pin toggle failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="font-mono"
            style={{
                marginTop: 14,
                padding: '14px 16px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
            }}
        >
            <div style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.6, flex: 1, minWidth: 240 }}>
                <span style={{ color: TEXT_DIM }}>// </span>
                Pin this hackathon to your DevProof profile so recruiters see it on{' '}
                <span style={{ color: '#A1A1A1' }}>/p/&lt;you&gt;</span>.
                {pinned ? ' Currently pinned.' : ' Not pinned yet.'}
            </div>
            <Button
                onClick={toggle}
                disabled={busy}
                variant={pinned ? 'default' : 'outline'}
                size="sm"
                className="gap-2"
            >
                {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Pin className="h-3.5 w-3.5" />
                )}
                {pinned ? 'Pinned to profile' : 'Pin to profile'}
            </Button>
            {err ? (
                <div style={{ fontSize: 11, color: '#FCA5A5', width: '100%' }}>// {err}</div>
            ) : null}
        </div>
    );
}

function ExtraValue({ value }: { value: unknown }) {
    if (Array.isArray(value)) {
        return (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {value.map((v, i) => (
                    <span
                        key={`${String(v)}-${i}`}
                        style={{
                            color: '#EDEDED',
                            padding: '1px 6px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            fontSize: 10,
                        }}
                    >
                        {String(v)}
                    </span>
                ))}
            </span>
        );
    }
    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        return (
            <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
                style={{
                    color: '#EDEDED',
                    wordBreak: 'break-all',
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: 4,
                }}
            >
                {value}
                <ExternalLink className="h-3 w-3" />
            </a>
        );
    }
    return (
        <span style={{ color: '#EDEDED', wordBreak: 'break-word' }}>
            {typeof value === 'string' ? value : JSON.stringify(value)}
        </span>
    );
}
