/**
 * LeaderboardRow — single ranked submission row for the public
 * hackathon leaderboard.
 *
 * Visual: bracket-corner schematic card matching the score-page
 * aesthetic. Rank in mono, repo_score in Clay tabular-nums (large),
 * sponsor matches as small chips.
 */

import type { CSSProperties } from 'react';
import type { LeaderboardRanking } from '@/lib/types/hackathon';

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';
const CORNER = 'rgba(255,255,255,0.18)';

function tierLabel(tier: LeaderboardRanking['repo_tier']): string {
    if (!tier) return '';
    return tier
        .replace('TIER_', 'T')
        .replace('_DEEP', '·DEEP')
        .replace('_LOGIC', '·LOGIC')
        .replace('_UI', '·UI');
}

interface LeaderboardRowProps {
    ranking: LeaderboardRanking;
    /**
     * If true, render a smaller variant suitable for sponsor
     * sub-leaderboards (top-3-per-sponsor sections).
     */
    compact?: boolean;
}

export function LeaderboardRow({ ranking, compact = false }: LeaderboardRowProps) {
    const repoSlug = ranking.github_url.replace('https://github.com/', '');
    const sponsorEntries = Object.entries(ranking.matched_sponsors || {});
    const team = ranking.team_members.length;

    const rankBadgeBase: CSSProperties = {
        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
        fontVariantNumeric: 'tabular-nums',
        fontSize: compact ? 22 : 28,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        color: ranking.rank === 1 ? CLAY : '#EDEDED',
        fontWeight: 500,
    };

    const corner: CSSProperties = {
        position: 'absolute',
        width: 10,
        height: 10,
        pointerEvents: 'none',
    };

    return (
        <a
            href={ranking.github_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block transition-opacity hover:opacity-90"
            style={{
                position: 'relative',
                padding: compact ? '20px 22px' : '26px 24px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                textDecoration: 'none',
            }}
        >
            {/* Bracket corners */}
            <span style={{ ...corner, top: 0, left: 0, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}` }} />
            <span style={{ ...corner, top: 0, right: 0, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}` }} />
            <span style={{ ...corner, bottom: 0, left: 0, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}` }} />
            <span style={{ ...corner, bottom: 0, right: 0, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}` }} />

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: compact ? '52px 1fr auto' : '64px 1fr auto',
                    gap: compact ? 14 : 18,
                    alignItems: 'center',
                }}
            >
                {/* Rank */}
                <div style={{ textAlign: 'left' }}>
                    <span
                        className="font-mono"
                        style={{
                            fontSize: 9,
                            color: TEXT_DIM,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            display: 'block',
                            marginBottom: 4,
                        }}
                    >
                        rank
                    </span>
                    <span style={rankBadgeBase}>
                        #{String(ranking.rank).padStart(2, '0')}
                    </span>
                </div>

                {/* Body */}
                <div style={{ minWidth: 0 }}>
                    <div
                        className="font-mono"
                        style={{
                            fontSize: compact ? 12 : 13,
                            color: '#EDEDED',
                            letterSpacing: '0.02em',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 6,
                        }}
                    >
                        {repoSlug}
                    </div>
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 11,
                            color: TEXT_DIM,
                            display: 'flex',
                            gap: 8,
                            flexWrap: 'wrap',
                            alignItems: 'baseline',
                            letterSpacing: '0.02em',
                        }}
                    >
                        <span style={{ color: '#A1A1A1' }}>@{ranking.submitter_username}</span>
                        {team > 0 && (
                            <>
                                <span style={{ opacity: 0.6 }}>·</span>
                                <span>+{team} team</span>
                            </>
                        )}
                        {ranking.repo_tier && (
                            <>
                                <span style={{ opacity: 0.6 }}>·</span>
                                <span>{tierLabel(ranking.repo_tier)}</span>
                            </>
                        )}
                    </div>

                    {/* Sponsor chips */}
                    {!compact && sponsorEntries.length > 0 && (
                        <div
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 6,
                                marginTop: 10,
                            }}
                        >
                            {sponsorEntries.map(([sponsorName, count]) => (
                                <span
                                    key={sponsorName}
                                    className="font-mono"
                                    style={{
                                        fontSize: 10,
                                        letterSpacing: '0.04em',
                                        padding: '3px 7px',
                                        border: `1px solid rgba(204,120,92,0.35)`,
                                        background: 'rgba(204,120,92,0.06)',
                                        color: CLAY,
                                        display: 'inline-flex',
                                        gap: 4,
                                        alignItems: 'baseline',
                                    }}
                                >
                                    <span>{sponsorName}</span>
                                    {count > 1 && (
                                        <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
                                            ×{count}
                                        </span>
                                    )}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Score */}
                <div style={{ textAlign: 'right' }}>
                    <span
                        className="font-mono"
                        style={{
                            fontSize: 9,
                            color: TEXT_DIM,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            display: 'block',
                            marginBottom: 4,
                        }}
                    >
                        score
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
                        <span
                            className="font-mono"
                            style={{
                                fontSize: compact ? 28 : 36,
                                color: CLAY,
                                fontVariantNumeric: 'tabular-nums',
                                letterSpacing: '-0.04em',
                                lineHeight: 1,
                                fontWeight: 400,
                            }}
                        >
                            {ranking.repo_score}
                        </span>
                        <span
                            className="font-mono"
                            style={{ fontSize: 11, color: TEXT_DIM }}
                        >
                            /100
                        </span>
                    </span>
                </div>
            </div>
        </a>
    );
}
