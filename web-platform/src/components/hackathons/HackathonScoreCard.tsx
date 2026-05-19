'use client';

/**
 * Score display for hackathon submissions. Single repo_score (no
 * person/reach axes — hackathon mode evaluates one repo, not a person).
 *
 * Visual style matches /p/[username]/score: bracket-corner schematic card,
 * mono labels with `·` separators, Clay only on the primary score number.
 *
 * Reusable in:
 *   - /hackathons/[slug]/me        (own submission view)
 *   - organizer admin dashboard    (Track C)
 *   - public leaderboard           (Track D)
 */

import type { RepoTierV4 } from '@/lib/types/v4-output';

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';
const CORNER = 'rgba(255,255,255,0.18)';

export interface HackathonScoreCardProps {
    repoScore: number;
    repoTier: RepoTierV4 | string | null;
    matchedSponsors?: Record<string, number> | null;
    deepAnalysisSeconds?: number | null;
    githubUrl?: string;
    submittedAt?: string;
    /** Top claim labels to surface (optional — left empty for MVP). */
    topClaims?: { feature: string; tier: string }[];
    /** Index label e.g. "01" for ranking; falls back to "—" when omitted. */
    rankLabel?: string;
}

function tierShort(tier: string | null): string {
    if (!tier) return '';
    return tier
        .replace('TIER_', 'T')
        .replace('_DEEP', '·DEEP')
        .replace('_LOGIC', '·LOGIC')
        .replace('_UI', '·UI');
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function HackathonScoreCard({
    repoScore,
    repoTier,
    matchedSponsors,
    deepAnalysisSeconds,
    githubUrl,
    submittedAt,
    topClaims,
    rankLabel,
}: HackathonScoreCardProps) {
    const sponsorEntries = matchedSponsors
        ? Object.entries(matchedSponsors).filter(([, n]) => n > 0)
        : [];
    const shortRepo = githubUrl
        ? githubUrl.replace('https://github.com/', '').replace('http://github.com/', '')
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
            {/* Bracket corners */}
            <span style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />

            {/* Top labels in corner gaps */}
            <div
                style={{
                    position: 'absolute',
                    top: 8,
                    left: 30,
                    right: 30,
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    color: TEXT_DIM,
                    letterSpacing: '0.12em',
                }}
            >
                <span>{rankLabel ? `RANK · ${rankLabel}` : 'SUBMISSION'}</span>
                <span>HACKATHON · V4</span>
            </div>

            {/* Bottom labels */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 8,
                    left: 30,
                    right: 30,
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                }}
            >
                <span style={{ color: CLAY }}>● COMPLETE</span>
                <span style={{ color: TEXT_DIM }}>
                    {deepAnalysisSeconds != null
                        ? `AUDITED · ${formatDuration(deepAnalysisSeconds)}`
                        : 'AUDITED'}
                </span>
            </div>

            <div style={{ paddingTop: 6 }}>
                {/* Repo URL line */}
                {shortRepo && (
                    <div
                        style={{
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            marginBottom: 4,
                            wordBreak: 'break-all',
                        }}
                    >
                        {shortRepo}
                    </div>
                )}

                {/* Big score readout */}
                <div
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: TEXT_DIM,
                        marginBottom: 8,
                    }}
                >
                    REPO_SCORE
                </div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 10,
                        marginBottom: 6,
                    }}
                >
                    <span
                        style={{
                            fontSize: 64,
                            fontWeight: 400,
                            color: CLAY,
                            fontVariantNumeric: 'tabular-nums',
                            lineHeight: 1,
                            letterSpacing: '-0.04em',
                        }}
                    >
                        {Math.round(repoScore)}
                    </span>
                    <span style={{ fontSize: 13, color: TEXT_DIM }}>/100</span>
                    {repoTier && (
                        <span
                            style={{
                                marginLeft: 6,
                                fontSize: 10,
                                letterSpacing: '0.12em',
                                color: CLAY,
                                padding: '3px 8px',
                                border: '1px solid rgba(204,120,92,0.35)',
                                background: 'rgba(204,120,92,0.06)',
                                textTransform: 'uppercase',
                            }}
                        >
                            {tierShort(typeof repoTier === 'string' ? repoTier : null)}
                        </span>
                    )}
                </div>
                {/* Hackathon-adjusted sub-label — context for the number above.
                 * The dev portfolio (/p/<username>) uses the full V4 score
                 * with forensics; hackathon surfaces drop forensics so
                 * single-push submissions aren't unfairly penalized. */}
                <div
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.04em',
                        marginBottom: 18,
                    }}
                >
                    // hackathon-adjusted · commits not weighted
                </div>

                {/* Sponsor matches */}
                {sponsorEntries.length > 0 && (
                    <>
                        <div className="h-px bg-border" style={{ margin: '14px 0' }} />
                        <div
                            style={{
                                fontSize: 10,
                                color: TEXT_DIM,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                marginBottom: 8,
                            }}
                        >
                            SPONSOR_MATCHES <span style={{ opacity: 0.6 }}>·</span>{' '}
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#A1A1A1' }}>
                                {String(sponsorEntries.length).padStart(2, '0')}
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {sponsorEntries.map(([name, count]) => (
                                <span
                                    key={name}
                                    style={{
                                        fontSize: 11,
                                        color: '#EDEDED',
                                        letterSpacing: '0.04em',
                                        padding: '4px 8px',
                                        border: `1px solid ${CLAY}`,
                                        background: 'rgba(204,120,92,0.06)',
                                        display: 'inline-flex',
                                        alignItems: 'baseline',
                                        gap: 4,
                                    }}
                                >
                                    <span style={{ color: TEXT_DIM }}>[</span>
                                    <span>{name}</span>
                                    {count > 1 && (
                                        <span
                                            style={{
                                                color: CLAY,
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            ×{count}
                                        </span>
                                    )}
                                    <span style={{ color: TEXT_DIM }}>]</span>
                                </span>
                            ))}
                        </div>
                    </>
                )}

                {/* Top claims (optional surface) */}
                {topClaims && topClaims.length > 0 && (
                    <>
                        <div className="h-px bg-border" style={{ margin: '18px 0 12px' }} />
                        <div
                            style={{
                                fontSize: 10,
                                color: TEXT_DIM,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                marginBottom: 10,
                            }}
                        >
                            // top_claims
                        </div>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {topClaims.slice(0, 3).map((c, i) => (
                                <li
                                    key={`${c.feature}-${i}`}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '24px 1fr auto',
                                        gap: 12,
                                        alignItems: 'baseline',
                                        padding: '8px 0',
                                        borderBottom: '1px solid var(--border)',
                                    }}
                                >
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: TEXT_DIM,
                                            fontVariantNumeric: 'tabular-nums',
                                        }}
                                    >
                                        {String(i + 1).padStart(2, '0')}
                                    </span>
                                    <span
                                        className="font-sans"
                                        style={{ fontSize: 12, color: '#EDEDED', lineHeight: 1.4 }}
                                    >
                                        {c.feature}
                                    </span>
                                    <span
                                        style={{
                                            fontSize: 10,
                                            color: TEXT_DIM,
                                            letterSpacing: '0.08em',
                                        }}
                                    >
                                        {tierShort(c.tier)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                {/* Footer meta strip */}
                {submittedAt && (
                    <>
                        <div className="h-px bg-border" style={{ margin: '14px 0' }} />
                        <div
                            style={{
                                fontSize: 10,
                                color: TEXT_DIM,
                                letterSpacing: '0.06em',
                                display: 'flex',
                                gap: 10,
                                flexWrap: 'wrap',
                            }}
                        >
                            <span>SUBMITTED · {new Date(submittedAt).toISOString().slice(0, 16).replace('T', ' ')}Z</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
