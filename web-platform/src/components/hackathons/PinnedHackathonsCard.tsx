/**
 * Server component — renders pinned hackathon cards on /p/[username].
 * No-op when the user has nothing pinned, so it's safe to slot into every
 * profile page unconditionally.
 */

import Link from 'next/link';
import { ExternalLink, Trophy } from 'lucide-react';
import { fetchPinnedHackathons } from '@/lib/hackathons';

const TEXT_DIM = '#666666';
const CORNER = 'rgba(255,255,255,0.18)';
const CLAY = '#CC785C';

function fmtMonth(d: string | null) {
    if (!d) return '';
    try {
        return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));
    } catch {
        return '';
    }
}

export async function PinnedHackathonsCard({ username }: { username: string }) {
    const pinned = await fetchPinnedHackathons(username);
    if (pinned.length === 0) return null;

    return (
        <section
            style={{ marginTop: 32, marginBottom: 32 }}
            aria-label="Pinned hackathons"
        >
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
                <span>HACKATHONS</span>
                <span style={{ opacity: 0.6 }}>·</span>
                <span>VERIFIED BY DEVPROOF</span>
                <span style={{ opacity: 0.6 }}>·</span>
                <span style={{ color: '#A1A1A1', fontVariantNumeric: 'tabular-nums' }}>
                    {String(pinned.length).padStart(2, '0')}
                </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pinned.map((p) => {
                    const sponsorEntries = Object.entries(p.submission.matched_sponsors ?? {});
                    return (
                        <article
                            key={p.submission.submission_id}
                            style={{
                                position: 'relative',
                                padding: '20px 22px',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px solid rgba(255,255,255,0.06)',
                            }}
                        >
                            <span style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}` }} />
                            <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}` }} />
                            <span style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}` }} />
                            <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}` }} />

                            {/* Header: tier badge + date */}
                            <div
                                className="font-mono"
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: 10,
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                    marginBottom: 12,
                                }}
                            >
                                <span style={{ color: CLAY, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <Trophy className="h-3 w-3" />
                                    {p.submission.repo_tier ?? 'AUDITED'}
                                </span>
                                <span style={{ color: TEXT_DIM }}>
                                    {fmtMonth(p.hackathon.ends_at)}
                                </span>
                            </div>

                            <h3
                                className="font-mono"
                                style={{
                                    fontSize: 16,
                                    color: '#EDEDED',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.02em',
                                    fontWeight: 500,
                                    marginBottom: 4,
                                    lineHeight: 1.3,
                                }}
                            >
                                {p.hackathon.name}
                            </h3>

                            <Link
                                href={p.submission.github_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono hover:text-primary"
                                style={{
                                    fontSize: 11,
                                    color: TEXT_DIM,
                                    letterSpacing: '0.04em',
                                    display: 'inline-flex',
                                    alignItems: 'baseline',
                                    gap: 4,
                                    marginBottom: 14,
                                }}
                            >
                                {p.submission.github_url.replace('https://github.com/', '')}
                                <ExternalLink className="h-3 w-3" />
                            </Link>

                            {/* Score line */}
                            <div
                                className="font-mono"
                                style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: 14,
                                    fontSize: 11,
                                    color: TEXT_DIM,
                                    marginBottom: sponsorEntries.length > 0 ? 12 : 0,
                                    marginTop: 8,
                                }}
                            >
                                <span>SCORE</span>
                                <span
                                    style={{
                                        color: '#EDEDED',
                                        fontSize: 22,
                                        fontVariantNumeric: 'tabular-nums',
                                        letterSpacing: '-0.02em',
                                    }}
                                >
                                    {p.submission.repo_score ?? '—'}
                                </span>
                                <span style={{ opacity: 0.6 }}>·</span>
                                <span>OUT OF 100</span>
                            </div>

                            {sponsorEntries.length > 0 ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                    {sponsorEntries.map(([name, count]) => (
                                        <span
                                            key={name}
                                            className="font-mono"
                                            style={{
                                                fontSize: 10,
                                                color: '#EDEDED',
                                                letterSpacing: '0.04em',
                                                padding: '4px 8px',
                                                border: `1px solid ${CLAY}`,
                                                background: 'rgba(204,120,92,0.06)',
                                            }}
                                        >
                                            {name}{count > 1 ? ` ×${count}` : ''}
                                        </span>
                                    ))}
                                </div>
                            ) : null}

                            {/* Footer link to event */}
                            <div
                                className="font-mono"
                                style={{
                                    marginTop: 14,
                                    paddingTop: 10,
                                    borderTop: '1px solid var(--border)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: 10,
                                    color: TEXT_DIM,
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                }}
                            >
                                <Link
                                    href={`/hackathons/${p.hackathon.slug}`}
                                    style={{ color: TEXT_DIM, textDecoration: 'none' }}
                                    className="hover:text-foreground"
                                >
                                    VIEW EVENT →
                                </Link>
                                <span>VERIFIED</span>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
