'use client';

import { useMemo } from 'react';
import Link from 'next/link';
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

interface SponsorBoard {
    name: string;
    prize?: string;
    rows: { submission: AdminSubmission; matches: number }[];
}

export function SponsorLeaderboardClient({ hackathon, submissions }: Props) {
    const boards = useMemo<SponsorBoard[]>(() => {
        const sponsors = hackathon.sponsors ?? [];
        return sponsors
            .map((sponsor) => {
                const rows = submissions
                    .filter(
                        (s) =>
                            s.matched_sponsors &&
                            s.matched_sponsors[sponsor.name] !== undefined &&
                            s.matched_sponsors[sponsor.name] > 0,
                    )
                    .map((s) => ({
                        submission: s,
                        matches: s.matched_sponsors[sponsor.name] ?? 0,
                    }))
                    .sort((a, b) => {
                        const sa = a.submission.repo_score ?? -1;
                        const sb = b.submission.repo_score ?? -1;
                        if (sb !== sa) return sb - sa;
                        return b.matches - a.matches;
                    });
                return { name: sponsor.name, prize: sponsor.prize, rows };
            })
            .sort((a, b) => b.rows.length - a.rows.length);
    }, [hackathon.sponsors, submissions]);

    return (
        <main className="container mx-auto px-4 py-10 max-w-5xl">
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
                    SPONSOR_LEADERBOARDS · {hackathon.name}
                </h1>
                <p
                    className="font-mono text-muted-foreground mt-2"
                    style={{ fontSize: 11, lineHeight: 1.6 }}
                >
                    <span style={{ color: TEXT_DIM }}>// </span>
                    Submissions ranked per sponsor by score · then by package match count.
                </p>
            </header>

            {boards.length === 0 ? (
                <div
                    className="font-mono"
                    style={{
                        padding: '48px 24px',
                        textAlign: 'center',
                        color: TEXT_DIM,
                        fontSize: 12,
                        letterSpacing: '0.04em',
                        border: '1px solid rgba(255,255,255,0.06)',
                    }}
                >
                    // no sponsors registered for this event
                </div>
            ) : (
                <div className="space-y-10">
                    {boards.map((board) => (
                        <section key={board.name}>
                            <div
                                className="font-mono"
                                style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: 10,
                                    marginBottom: 12,
                                    flexWrap: 'wrap',
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: 14,
                                        color: '#EDEDED',
                                        letterSpacing: '0.04em',
                                        textTransform: 'uppercase',
                                        fontWeight: 500,
                                    }}
                                >
                                    {board.name}
                                </span>
                                <span style={{ color: TEXT_DIM, opacity: 0.6 }}>·</span>
                                <span
                                    style={{
                                        fontSize: 11,
                                        color: TEXT_DIM,
                                        letterSpacing: '0.06em',
                                    }}
                                >
                                    {board.rows.length} match
                                    {board.rows.length === 1 ? '' : 'es'}
                                </span>
                                {board.prize && (
                                    <>
                                        <span style={{ color: TEXT_DIM, opacity: 0.6 }}>·</span>
                                        <span
                                            style={{
                                                fontSize: 11,
                                                color: CLAY,
                                                letterSpacing: '0.06em',
                                            }}
                                        >
                                            {board.prize}
                                        </span>
                                    </>
                                )}
                            </div>
                            {board.rows.length === 0 ? (
                                <div
                                    className="font-mono"
                                    style={{
                                        padding: '20px 16px',
                                        color: TEXT_DIM,
                                        fontSize: 11,
                                        letterSpacing: '0.04em',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                    }}
                                >
                                    // no submissions used a {board.name} package
                                </div>
                            ) : (
                                <div
                                    style={{
                                        border: '1px solid rgba(255,255,255,0.06)',
                                        background: 'rgba(255,255,255,0.01)',
                                    }}
                                >
                                    {board.rows.map((row, i) => (
                                        <Link
                                            key={row.submission.submission_id}
                                            href={`/hackathons/${hackathon.slug}/admin/judge?submission=${row.submission.submission_id}`}
                                            className="font-mono group block hover:bg-white/[0.02] transition-colors"
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    '40px minmax(140px, 1.2fr) 1fr 80px 80px',
                                                gap: 12,
                                                alignItems: 'center',
                                                padding: '12px 16px',
                                                fontSize: 12,
                                                borderBottom:
                                                    '1px solid var(--border)',
                                            }}
                                        >
                                            <span
                                                style={{
                                                    color: i < 3 ? CLAY : TEXT_DIM,
                                                    fontVariantNumeric: 'tabular-nums',
                                                }}
                                            >
                                                {String(i + 1).padStart(2, '0')}
                                            </span>
                                            <span
                                                style={{
                                                    color: '#EDEDED',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {row.submission.submitter_username}
                                            </span>
                                            <span
                                                style={{
                                                    color: '#A1A1A1',
                                                    fontSize: 11,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {row.submission.github_url.replace(
                                                    'https://github.com/',
                                                    '',
                                                )}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 14,
                                                    color:
                                                        row.submission.repo_score !==
                                                        null
                                                            ? row.submission.repo_score >=
                                                              80
                                                                ? CLAY
                                                                : '#EDEDED'
                                                            : TEXT_DIM,
                                                    fontVariantNumeric: 'tabular-nums',
                                                }}
                                            >
                                                {row.submission.repo_score ?? '—'}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 11,
                                                    color: TEXT_DIM,
                                                    letterSpacing: '0.06em',
                                                    textAlign: 'right',
                                                }}
                                            >
                                                ×{row.matches} claim
                                                {row.matches === 1 ? '' : 's'}
                                            </span>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </section>
                    ))}
                </div>
            )}
        </main>
    );
}
