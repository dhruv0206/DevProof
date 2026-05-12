'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type {
    AdminSubmission,
    HackathonDetail,
} from '@/lib/types/hackathon';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

interface Props {
    hackathon: HackathonDetail;
    submissions: AdminSubmission[];
}

function commentKey(slug: string, submissionId: string) {
    return `devproof:hackathon-judge-comment:${slug}:${submissionId}`;
}

function tierLabel(tier: AdminSubmission['repo_tier']): string {
    if (!tier) return '—';
    return tier
        .replace('TIER_', 'T')
        .replace('_DEEP', '·DEEP')
        .replace('_LOGIC', '·LOGIC')
        .replace('_UI', '·UI');
}

function StatusDot({ status }: { status: AdminSubmission['audit_status'] }) {
    let color = TEXT_DIM;
    if (status === 'complete') color = '#00FF41';
    else if (status === 'running') color = '#F59E0B';
    else if (status === 'failed') color = '#EF4444';
    return (
        <span
            style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: color,
            }}
        />
    );
}

function SubmissionDetailCard({
    submission,
    slug,
    onCommentChange,
    initialComment,
}: {
    submission: AdminSubmission;
    slug: string;
    onCommentChange?: (next: string) => void;
    initialComment?: string;
}) {
    const [comment, setComment] = useState(initialComment ?? '');
    useEffect(() => {
        setComment(initialComment ?? '');
    }, [initialComment, submission.submission_id]);

    const commit = () => {
        try {
            localStorage.setItem(
                commentKey(slug, submission.submission_id),
                comment,
            );
        } catch {
            /* ignore */
        }
        onCommentChange?.(comment);
    };

    const sponsors = Object.entries(submission.matched_sponsors ?? {});
    const repoShort = submission.github_url.replace('https://github.com/', '');

    return (
        <div
            className="font-mono"
            style={{
                position: 'relative',
                padding: '24px 24px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            <div
                style={{
                    fontSize: 10,
                    color: TEXT_DIM,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                }}
            >
                <StatusDot status={submission.audit_status} />{' '}
                <span style={{ marginLeft: 8 }}>
                    {submission.audit_status}
                </span>
                <span style={{ opacity: 0.6, margin: '0 8px' }}>·</span>
                <span>{tierLabel(submission.repo_tier)}</span>
            </div>
            <h2
                style={{
                    fontSize: 18,
                    color: '#EDEDED',
                    letterSpacing: '0.02em',
                    fontWeight: 500,
                    marginBottom: 4,
                }}
            >
                {submission.submitter_username}
            </h2>
            {submission.team_members && submission.team_members.length > 1 && (
                <div
                    style={{
                        fontSize: 11,
                        color: TEXT_DIM,
                        letterSpacing: '0.04em',
                        marginBottom: 12,
                    }}
                >
                    team:{' '}
                    {submission.team_members.join(' · ')}
                </div>
            )}
            <a
                href={submission.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
                style={{
                    fontSize: 12,
                    color: '#A1A1A1',
                    letterSpacing: '0.02em',
                    wordBreak: 'break-all',
                    display: 'block',
                    marginBottom: 18,
                }}
            >
                {repoShort} ↗
            </a>

            {/* Score */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    marginBottom: 18,
                }}
            >
                <span
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                    }}
                >
                    score
                </span>
                {submission.repo_score !== null ? (
                    <>
                        <span
                            style={{
                                fontSize: 44,
                                color: CLAY,
                                fontVariantNumeric: 'tabular-nums',
                                letterSpacing: '-0.04em',
                                lineHeight: 1,
                                fontWeight: 400,
                            }}
                        >
                            {submission.repo_score}
                        </span>
                        <span style={{ fontSize: 12, color: TEXT_DIM }}>/100</span>
                    </>
                ) : (
                    <span style={{ fontSize: 44, color: TEXT_DIM, lineHeight: 1 }}>
                        —
                    </span>
                )}
            </div>

            {/* Sponsors */}
            <div
                style={{
                    fontSize: 10,
                    color: TEXT_DIM,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                }}
            >
                sponsors_matched
            </div>
            {sponsors.length === 0 ? (
                <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 14 }}>
                    // no sponsor packages detected
                </div>
            ) : (
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginBottom: 14,
                    }}
                >
                    {sponsors.map(([name, count]) => (
                        <span
                            key={name}
                            style={{
                                fontSize: 11,
                                color: '#EDEDED',
                                letterSpacing: '0.04em',
                                padding: '4px 8px',
                                border: `1px solid ${count > 1 ? CLAY : 'rgba(255,255,255,0.08)'}`,
                                background:
                                    count > 1 ? 'rgba(204,120,92,0.06)' : 'transparent',
                            }}
                        >
                            <span style={{ color: TEXT_DIM }}>[</span>
                            {name}
                            {count > 1 && (
                                <span style={{ color: CLAY, marginLeft: 3 }}>
                                    ×{count}
                                </span>
                            )}
                            <span style={{ color: TEXT_DIM }}>]</span>
                        </span>
                    ))}
                </div>
            )}

            {/* Extras */}
            {submission.extras && Object.keys(submission.extras).length > 0 && (
                <>
                    <div
                        style={{
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            marginBottom: 6,
                        }}
                    >
                        extras
                    </div>
                    <ul
                        style={{
                            listStyle: 'none',
                            padding: 0,
                            margin: '0 0 14px 0',
                            fontSize: 11,
                        }}
                    >
                        {Object.entries(submission.extras).map(([k, v]) => (
                            <li
                                key={k}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '140px 1fr',
                                    gap: 10,
                                    padding: '6px 0',
                                    borderBottom: '1px solid var(--border)',
                                }}
                            >
                                <span
                                    style={{
                                        color: TEXT_DIM,
                                        letterSpacing: '0.04em',
                                    }}
                                >
                                    {k}
                                </span>
                                <span style={{ color: '#EDEDED', wordBreak: 'break-word' }}>
                                    {typeof v === 'string' && /^https?:\/\//.test(v) ? (
                                        <a
                                            href={v}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:text-primary"
                                        >
                                            {v}
                                        </a>
                                    ) : (
                                        String(v)
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {/* Audit timing */}
            {submission.deep_analysis_seconds !== null && (
                <div
                    style={{
                        fontSize: 11,
                        color: TEXT_DIM,
                        letterSpacing: '0.04em',
                        marginBottom: 14,
                    }}
                >
                    audit · {submission.deep_analysis_seconds}s
                </div>
            )}

            {submission.audit_status === 'failed' && submission.audit_error && (
                <div
                    style={{
                        padding: '8px 10px',
                        marginBottom: 14,
                        border: '1px solid rgba(239,68,68,0.3)',
                        background: 'rgba(239,68,68,0.06)',
                        color: '#fca5a5',
                        fontSize: 11,
                    }}
                >
                    // {submission.audit_error}
                </div>
            )}

            {/* Comment field — local-only for MVP */}
            <div
                style={{
                    fontSize: 10,
                    color: TEXT_DIM,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                }}
            >
                judge_note · local
            </div>
            <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onBlur={commit}
                placeholder="Private notes — saved to your browser only."
                rows={3}
                className="font-mono"
                style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: 12,
                    color: '#EDEDED',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                }}
            />
        </div>
    );
}

export function JudgeViewClient({ hackathon, submissions }: Props) {
    const params = useSearchParams();
    const initialId = params.get('submission');

    const [primaryId, setPrimaryId] = useState<string | null>(
        initialId && submissions.some((s) => s.submission_id === initialId)
            ? initialId
            : (submissions[0]?.submission_id ?? null),
    );
    const [compareId, setCompareId] = useState<string | null>(null);

    // Comments restore for the active submissions
    const [primaryComment, setPrimaryComment] = useState('');
    const [compareComment, setCompareComment] = useState('');

    useEffect(() => {
        if (!primaryId) {
            setPrimaryComment('');
            return;
        }
        try {
            setPrimaryComment(
                localStorage.getItem(commentKey(hackathon.slug, primaryId)) ?? '',
            );
        } catch {
            setPrimaryComment('');
        }
    }, [primaryId, hackathon.slug]);

    useEffect(() => {
        if (!compareId) {
            setCompareComment('');
            return;
        }
        try {
            setCompareComment(
                localStorage.getItem(commentKey(hackathon.slug, compareId)) ?? '',
            );
        } catch {
            setCompareComment('');
        }
    }, [compareId, hackathon.slug]);

    const primary = useMemo(
        () => submissions.find((s) => s.submission_id === primaryId) ?? null,
        [submissions, primaryId],
    );
    const compare = useMemo(
        () =>
            compareId
                ? (submissions.find((s) => s.submission_id === compareId) ?? null)
                : null,
        [submissions, compareId],
    );

    const dropdownStyle: React.CSSProperties = {
        padding: '6px 10px',
        fontSize: 12,
        color: '#EDEDED',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
        outline: 'none',
        fontFamily: 'inherit',
        minWidth: 220,
    };

    return (
        <main className="container mx-auto px-4 py-10 max-w-6xl">
            {/* Header */}
            <header className="mb-8">
                <Link
                    href={`/hackathons/${hackathon.slug}/admin`}
                    className="font-mono text-[11px] text-muted-foreground hover:text-foreground tracking-[0.08em]"
                >
                    ← BACK_TO_DASHBOARD
                </Link>
                <h1
                    className="font-mono mt-3"
                    style={{
                        fontSize: 22,
                        fontWeight: 500,
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase',
                    }}
                >
                    JUDGING · {hackathon.name}
                </h1>
            </header>

            {/* Selectors */}
            <div
                className="font-mono"
                style={{
                    display: 'flex',
                    gap: 16,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    padding: '14px 16px',
                    background: 'rgba(255,255,255,0.015)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    marginBottom: 20,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                        style={{
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                        }}
                    >
                        Primary
                    </span>
                    <select
                        value={primaryId ?? ''}
                        onChange={(e) => setPrimaryId(e.target.value || null)}
                        style={dropdownStyle}
                    >
                        {submissions.map((s) => (
                            <option key={s.submission_id} value={s.submission_id}>
                                {s.submitter_username}
                                {s.repo_score !== null ? ` · ${s.repo_score}` : ''}
                            </option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                        style={{
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                        }}
                    >
                        Compare
                    </span>
                    <select
                        value={compareId ?? ''}
                        onChange={(e) => setCompareId(e.target.value || null)}
                        style={dropdownStyle}
                    >
                        <option value="">— none —</option>
                        {submissions
                            .filter((s) => s.submission_id !== primaryId)
                            .map((s) => (
                                <option key={s.submission_id} value={s.submission_id}>
                                    {s.submitter_username}
                                    {s.repo_score !== null ? ` · ${s.repo_score}` : ''}
                                </option>
                            ))}
                    </select>
                </div>
            </div>

            {/* Detail cards */}
            <div
                className={`grid gap-4 ${compare ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}
            >
                {primary ? (
                    <SubmissionDetailCard
                        submission={primary}
                        slug={hackathon.slug}
                        initialComment={primaryComment}
                        onCommentChange={setPrimaryComment}
                    />
                ) : (
                    <div className="font-mono text-sm text-muted-foreground p-8 text-center">
                        // no submission selected
                    </div>
                )}
                {compare && (
                    <SubmissionDetailCard
                        submission={compare}
                        slug={hackathon.slug}
                        initialComment={compareComment}
                        onCommentChange={setCompareComment}
                    />
                )}
            </div>

            <p
                className="font-mono text-muted-foreground mt-6"
                style={{ fontSize: 11, lineHeight: 1.6 }}
            >
                <span style={{ color: TEXT_DIM }}>// </span>
                Notes are stored locally per browser. Full claim-level evidence
                breakdown ships once Track A exposes the V4 output endpoint.
            </p>
        </main>
    );
}
