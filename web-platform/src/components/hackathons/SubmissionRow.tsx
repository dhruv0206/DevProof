'use client';

import Link from 'next/link';
import type { AdminSubmission } from '@/lib/types/hackathon';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

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
                boxShadow: status === 'complete' ? '0 0 6px rgba(0,255,65,0.5)' : 'none',
            }}
        />
    );
}

function SponsorChip({ name, count }: { name: string; count: number }) {
    return (
        <span
            className="font-mono"
            style={{
                fontSize: 10,
                color: '#EDEDED',
                letterSpacing: '0.04em',
                padding: '2px 6px',
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'transparent',
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 3,
            }}
        >
            <span style={{ color: TEXT_DIM }}>[</span>
            <span>{name}</span>
            {count > 1 && (
                <span style={{ color: CLAY, fontVariantNumeric: 'tabular-nums' }}>
                    ×{count}
                </span>
            )}
            <span style={{ color: TEXT_DIM }}>]</span>
        </span>
    );
}

export interface SubmissionRowProps {
    rank: number;
    submission: AdminSubmission;
    /** Slug of the hackathon for navigation links. */
    slug: string;
}

export function SubmissionRow({ rank, submission, slug }: SubmissionRowProps) {
    const repoShort = submission.github_url.replace('https://github.com/', '');
    const time = submission.deep_analysis_seconds
        ? `${submission.deep_analysis_seconds}s`
        : '—';
    const teamCount = submission.team_members?.length ?? 0;
    const sponsors = Object.entries(submission.matched_sponsors ?? {});

    return (
        <Link
            href={`/hackathons/${slug}/admin/judge?submission=${submission.submission_id}`}
            className="group block hover:bg-white/[0.02] transition-colors"
            style={{
                borderBottom: '1px solid var(--border)',
            }}
        >
            <div
                className="font-mono"
                style={{
                    display: 'grid',
                    gridTemplateColumns:
                        '40px minmax(140px, 1.2fr) minmax(180px, 1.6fr) 80px 70px minmax(140px, 1.2fr) 70px 80px',
                    gap: 12,
                    alignItems: 'center',
                    padding: '14px 16px',
                    fontSize: 12,
                }}
            >
                {/* Rank */}
                <div
                    style={{
                        fontVariantNumeric: 'tabular-nums',
                        color: rank <= 3 ? CLAY : TEXT_DIM,
                        letterSpacing: '0.04em',
                    }}
                >
                    {String(rank).padStart(2, '0')}
                </div>

                {/* Submitter */}
                <div style={{ minWidth: 0 }}>
                    <div
                        style={{
                            color: '#EDEDED',
                            letterSpacing: '0.02em',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {submission.submitter_username}
                    </div>
                    {teamCount > 1 && (
                        <div
                            style={{
                                fontSize: 10,
                                color: TEXT_DIM,
                                letterSpacing: '0.06em',
                                marginTop: 2,
                            }}
                        >
                            +{teamCount - 1} teammate{teamCount > 2 ? 's' : ''}
                        </div>
                    )}
                </div>

                {/* Repo URL */}
                <div
                    style={{
                        color: '#A1A1A1',
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                    title={submission.github_url}
                >
                    {repoShort}
                </div>

                {/* Tier */}
                <div
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.06em',
                    }}
                >
                    {tierLabel(submission.repo_tier)}
                </div>

                {/* Score */}
                <div
                    style={{
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 16,
                        color:
                            submission.repo_score !== null
                                ? submission.repo_score >= 80
                                    ? CLAY
                                    : '#EDEDED'
                                : TEXT_DIM,
                        letterSpacing: '-0.02em',
                    }}
                >
                    {submission.repo_score ?? '—'}
                </div>

                {/* Sponsors */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {sponsors.length === 0 ? (
                        <span style={{ color: TEXT_DIM, fontSize: 10 }}>—</span>
                    ) : (
                        sponsors.slice(0, 3).map(([name, count]) => (
                            <SponsorChip key={name} name={name} count={count} />
                        ))
                    )}
                    {sponsors.length > 3 && (
                        <span style={{ color: TEXT_DIM, fontSize: 10 }}>
                            +{sponsors.length - 3}
                        </span>
                    )}
                </div>

                {/* Audit time */}
                <div
                    style={{
                        fontVariantNumeric: 'tabular-nums',
                        color: TEXT_DIM,
                        fontSize: 11,
                    }}
                >
                    {time}
                </div>

                {/* Status */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 10,
                        color: '#A1A1A1',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                    }}
                >
                    <StatusDot status={submission.audit_status} />
                    <span>{submission.audit_status}</span>
                </div>
            </div>
        </Link>
    );
}

/** Header row matching the column layout above. */
export function SubmissionRowHeader() {
    const cellStyle: React.CSSProperties = {
        fontSize: 10,
        color: TEXT_DIM,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
    };
    return (
        <div
            className="font-mono"
            style={{
                display: 'grid',
                gridTemplateColumns:
                    '40px minmax(140px, 1.2fr) minmax(180px, 1.6fr) 80px 70px minmax(140px, 1.2fr) 70px 80px',
                gap: 12,
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.015)',
            }}
        >
            <div style={cellStyle}>#</div>
            <div style={cellStyle}>Submitter</div>
            <div style={cellStyle}>Repo</div>
            <div style={cellStyle}>Tier</div>
            <div style={cellStyle}>Score</div>
            <div style={cellStyle}>Sponsors</div>
            <div style={cellStyle}>Time</div>
            <div style={cellStyle}>Status</div>
        </div>
    );
}
