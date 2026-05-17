'use client';

/**
 * Organizer-side aggregated judge scores.
 *
 * Shows one row per submission with avg score, judge count, and an
 * expandable per-judge breakdown (name + score + notes + saved-at).
 *
 * Rendered on /hackathons/[slug]/admin/judges and is fully read-only —
 * organizers don't edit judges' scores from this view.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { JudgeScoresResult } from '@/lib/hackathons';
import type { AdminSubmission } from '@/lib/types/hackathon';

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';
const BORDER = 'rgba(255,255,255,0.08)';
const SURFACE_HOVER = 'rgba(255,255,255,0.02)';

interface Props {
    judgeScores: JudgeScoresResult;
    submissions: AdminSubmission[];
    /** Hackathon slug, needed for "View audit" deep-links. */
    slug: string;
}

export function JudgingResultsSection({ judgeScores, submissions, slug }: Props) {
    const [expanded, setExpanded] = useState<string | null>(null);

    // Annotate submissions with their judge aggregate (if any).
    const rows = submissions.map((s) => {
        const agg = judgeScores.bySubmission[s.submission_id];
        return { submission: s, agg };
    });

    // Sort: highest avg first, then by V4 audit score as tiebreaker.
    rows.sort((a, b) => {
        const aAvg = a.agg?.avg_score ?? -1;
        const bAvg = b.agg?.avg_score ?? -1;
        if (aAvg !== bAvg) return bAvg - aAvg;
        return (b.submission.repo_score ?? -1) - (a.submission.repo_score ?? -1);
    });

    const totalScored = rows.filter((r) => (r.agg?.scored_count ?? 0) > 0).length;
    const allJudgesSet = new Set<string>();
    for (const r of rows) {
        for (const j of r.agg?.judges ?? []) allJudgesSet.add(j.judge_name);
    }
    const totalJudges = allJudgesSet.size;

    if (!judgeScores.judgeLinkSet) {
        return (
            <div
                className="rounded-lg border p-6 text-sm"
                style={{ borderColor: BORDER, color: TEXT_DIM }}
            >
                No judge link issued yet — open the <strong>Team</strong> tab
                and click <em>Generate judge link</em> to share with your
                judging panel.
            </div>
        );
    }

    if (submissions.length === 0) {
        return (
            <div
                className="rounded-lg border p-6 text-sm"
                style={{ borderColor: BORDER, color: TEXT_DIM }}
            >
                No submissions yet — once participants submit, you'll see
                their judging scores here.
            </div>
        );
    }

    return (
        <>
            <div className="text-xs mb-3" style={{ color: TEXT_DIM }}>
                {totalScored}/{submissions.length} submissions scored ·{' '}
                {totalJudges} judge{totalJudges === 1 ? '' : 's'} active
            </div>
            <ul className="space-y-2">
                {rows.map(({ submission, agg }) => {
                    const isOpen = expanded === submission.submission_id;
                    const judges = agg?.judges ?? [];
                    const avgDisplay =
                        agg?.avg_score !== null && agg?.avg_score !== undefined
                            ? agg.avg_score.toFixed(1)
                            : '—';
                    const judgeCount = agg?.judge_count ?? 0;
                    // TOTAL = sum of every judge's score (excluding nulls).
                    // Format as integer if whole (e.g. "40"), one decimal
                    // otherwise (e.g. "37.5"). Max possible = judges×10.
                    const totalRaw = judges.reduce(
                        (sum, j) => (j.score !== null ? sum + j.score : sum),
                        0,
                    );
                    const totalDisplay =
                        agg?.scored_count && agg.scored_count > 0
                            ? Number.isInteger(totalRaw)
                                ? String(totalRaw)
                                : totalRaw.toFixed(1)
                            : '—';

                    return (
                        <li
                            key={submission.submission_id}
                            className="rounded-lg border"
                            style={{ borderColor: BORDER }}
                        >
                            <button
                                type="button"
                                onClick={() =>
                                    setExpanded(isOpen ? null : submission.submission_id)
                                }
                                className="w-full text-left p-4 flex items-center justify-between gap-4 transition-colors"
                                style={{
                                    backgroundColor: isOpen ? SURFACE_HOVER : 'transparent',
                                }}
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate">
                                        @{submission.submitter_username}
                                    </p>
                                    <p
                                        className="text-xs truncate"
                                        style={{ color: TEXT_DIM }}
                                    >
                                        {submission.github_url.replace(
                                            'https://github.com/',
                                            '',
                                        )}
                                    </p>
                                </div>
                                <div
                                    className="flex items-center gap-4 flex-shrink-0"
                                    style={{ fontVariantNumeric: 'tabular-nums' }}
                                >
                                    <div className="text-right">
                                        <div className="text-xs" style={{ color: TEXT_DIM }}>
                                            AUDIT
                                        </div>
                                        <div className="text-sm">
                                            {submission.repo_score ?? '—'}
                                            <span
                                                className="text-xs ml-0.5"
                                                style={{ color: TEXT_DIM }}
                                            >
                                                /100
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right" style={{ minWidth: 64 }}>
                                        <div className="text-xs" style={{ color: TEXT_DIM }}>
                                            AVG
                                        </div>
                                        <div
                                            className="text-sm font-medium"
                                            style={{
                                                color:
                                                    agg?.avg_score !== null &&
                                                    agg?.avg_score !== undefined
                                                        ? CLAY
                                                        : TEXT_DIM,
                                            }}
                                        >
                                            {avgDisplay}
                                            {agg?.avg_score !== null &&
                                                agg?.avg_score !== undefined && (
                                                    <span
                                                        className="text-xs ml-0.5"
                                                        style={{ color: TEXT_DIM }}
                                                    >
                                                        /5
                                                    </span>
                                                )}
                                        </div>
                                    </div>
                                    <div className="text-right" style={{ minWidth: 56 }}>
                                        <div className="text-xs" style={{ color: TEXT_DIM }}>
                                            TOTAL
                                        </div>
                                        <div
                                            className="text-sm font-medium"
                                            style={{
                                                color:
                                                    totalDisplay !== '—' ? CLAY : TEXT_DIM,
                                            }}
                                        >
                                            {totalDisplay}
                                            {totalDisplay !== '—' && judgeCount > 0 && (
                                                <span
                                                    className="text-xs ml-0.5"
                                                    style={{ color: TEXT_DIM }}
                                                >
                                                    /{judgeCount * 5}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div
                                        className="text-xs"
                                        style={{ color: TEXT_DIM, minWidth: 64 }}
                                    >
                                        {judgeCount} judge{judgeCount === 1 ? '' : 's'}
                                    </div>
                                    <span style={{ color: TEXT_DIM, fontSize: 11 }}>
                                        {isOpen ? '▾' : '▸'}
                                    </span>
                                </div>
                            </button>
                            {isOpen && (
                                <div className="border-t" style={{ borderColor: BORDER }}>
                                    <div className="p-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                                        <Link
                                            href={`/hackathons/${slug}/admin/submission/${submission.submission_id}`}
                                            className="text-xs underline"
                                            style={{ color: CLAY }}
                                        >
                                            View full audit detail →
                                        </Link>
                                    </div>
                                    {judges.length === 0 ? (
                                        <p className="p-4 text-xs" style={{ color: TEXT_DIM }}>
                                            No judge has opened this submission yet.
                                        </p>
                                    ) : (
                                        <ul>
                                            {judges.map((j) => (
                                                <li
                                                    key={j.judge_name}
                                                    className="p-4 border-t"
                                                    style={{ borderColor: BORDER }}
                                                >
                                                    <div className="flex items-baseline justify-between gap-3">
                                                        <div className="text-sm font-medium">
                                                            @{j.judge_name}
                                                        </div>
                                                        <div
                                                            className="text-sm font-medium"
                                                            style={{
                                                                color:
                                                                    j.score !== null
                                                                        ? CLAY
                                                                        : TEXT_DIM,
                                                                fontVariantNumeric:
                                                                    'tabular-nums',
                                                            }}
                                                        >
                                                            {j.score !== null ? j.score : '—'}
                                                            <span
                                                                className="text-xs ml-0.5"
                                                                style={{ color: TEXT_DIM }}
                                                            >
                                                                /5
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {j.notes && (
                                                        <p
                                                            className="text-xs mt-1"
                                                            style={{
                                                                color: '#A1A1A1',
                                                                whiteSpace: 'pre-wrap',
                                                            }}
                                                        >
                                                            {j.notes}
                                                        </p>
                                                    )}
                                                    {j.updated_at && (
                                                        <p
                                                            className="text-xs mt-1"
                                                            style={{ color: TEXT_DIM }}
                                                        >
                                                            saved{' '}
                                                            {new Date(
                                                                j.updated_at,
                                                            ).toLocaleString()}
                                                        </p>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </>
    );
}
