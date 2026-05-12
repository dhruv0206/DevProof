import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LandingNavbar } from '@/components/landing/LandingNavbar';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { SponsorChip } from '@/components/hackathons/SponsorChip';
import { LeaderboardRow } from '@/components/hackathons/LeaderboardRow';
import { HackathonBadge } from '@/components/hackathons/HackathonBadge';
import type {
    HackathonDetail,
    LeaderboardResponse,
} from '@/lib/types/hackathon';

/**
 * `/hackathons/[slug]` — Public hackathon page (the SEO + viral surface).
 *
 * Sections:
 *   1. Hero — name, description, dates, status, sponsor chips
 *   2. Rules / what we're judging
 *   3. "Join with code" CTA → `/hackathons/[slug]/join`
 *   4. Sponsor list with prizes
 *   5. Leaderboard (only when `is_published === true`)
 *   6. Embed-snippet card (Audited by DevProof badge)
 *
 * No auth required — server-rendered for crawlers and OG previews.
 */

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://devproof.com';

async function fetchHackathon(slug: string): Promise<HackathonDetail | null> {
    try {
        const res = await fetch(`${API_URL}/api/hackathons/${encodeURIComponent(slug)}`, {
            next: { revalidate: 60 },
        });
        if (!res.ok) return null;
        return (await res.json()) as HackathonDetail;
    } catch {
        return null;
    }
}

async function fetchLeaderboard(slug: string): Promise<LeaderboardResponse | null> {
    try {
        const res = await fetch(
            `${API_URL}/api/hackathons/${encodeURIComponent(slug)}/leaderboard`,
            { next: { revalidate: 60 } }
        );
        if (!res.ok) return null;
        return (await res.json()) as LeaderboardResponse;
    } catch {
        return null;
    }
}

// ─── SEO metadata ────────────────────────────────────────────────────────────

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const event = await fetchHackathon(slug);

    if (!event) {
        return {
            title: 'Hackathon not found',
            description: 'This hackathon does not exist on DevProof.',
        };
    }

    const startDate = new Date(event.starts_at).toISOString().slice(0, 10);
    const description =
        event.description?.slice(0, 160) ||
        `${event.name} — ${event.submission_count} submissions, AI-verified judging by DevProof. Public leaderboard${event.is_published ? ' available' : ' coming soon'}.`;

    const eventUrl = `${SITE_ORIGIN}/hackathons/${slug}`;

    return {
        title: event.name,
        description,
        alternates: {
            canonical: eventUrl,
        },
        openGraph: {
            title: `${event.name} · DevProof`,
            description,
            url: eventUrl,
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title: `${event.name} · DevProof`,
            description,
        },
        other: {
            'event:start_date': startDate,
            'event:end_date': new Date(event.ends_at).toISOString().slice(0, 10),
        },
    };
}

// ─── Atoms ──────────────────────────────────────────────────────────────────

function CornerBrackets() {
    const corner: React.CSSProperties = {
        position: 'absolute',
        width: 10,
        height: 10,
        pointerEvents: 'none',
        borderColor: 'rgba(255,255,255,0.18)',
        borderStyle: 'solid',
        borderWidth: 0,
    };
    return (
        <>
            <span style={{ ...corner, top: 0, left: 0, borderTopWidth: 1, borderLeftWidth: 1 }} />
            <span style={{ ...corner, top: 0, right: 0, borderTopWidth: 1, borderRightWidth: 1 }} />
            <span style={{ ...corner, bottom: 0, left: 0, borderBottomWidth: 1, borderLeftWidth: 1 }} />
            <span style={{ ...corner, bottom: 0, right: 0, borderBottomWidth: 1, borderRightWidth: 1 }} />
        </>
    );
}

function CommentHeader({ label, version }: { label: string; version?: string }) {
    return (
        <div
            className="font-mono"
            style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: TEXT_DIM,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
            }}
        >
            <span>{label}</span>
            {version ? (
                <>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>{version}</span>
                </>
            ) : null}
        </div>
    );
}

function Hairline() {
    return <div className="h-px bg-border" />;
}

function eventStatus(event: HackathonDetail): { label: string; statusOk: boolean } {
    const now = Date.now();
    const start = new Date(event.starts_at).getTime();
    const end = new Date(event.ends_at).getTime();
    const close = new Date(event.submissions_close_at).getTime();
    if (now < start) return { label: 'UPCOMING', statusOk: false };
    if (now <= close) return { label: 'LIVE · ACCEPTING SUBMISSIONS', statusOk: true };
    if (now <= end) return { label: 'JUDGING IN PROGRESS', statusOk: true };
    if (event.is_published) return { label: 'COMPLETE · LEADERBOARD PUBLISHED', statusOk: true };
    return { label: 'COMPLETE', statusOk: false };
}

function formatLong(date: string): string {
    try {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
        }).format(new Date(date));
    } catch {
        return date;
    }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function HackathonPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const event = await fetchHackathon(slug);

    if (!event) {
        notFound();
    }

    const status = eventStatus(event);
    const leaderboard = event.is_published ? await fetchLeaderboard(slug) : null;
    const sponsorEntries = leaderboard?.sponsor_leaderboards
        ? Object.entries(leaderboard.sponsor_leaderboards)
        : [];

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <LandingNavbar />

            <main className="container mx-auto px-4 max-w-5xl pt-28 pb-20 flex-1 w-full">
                {/* ─── Breadcrumb ─── */}
                <nav
                    className="font-mono"
                    style={{
                        fontSize: 11,
                        letterSpacing: '0.04em',
                        color: TEXT_DIM,
                        marginBottom: 18,
                        display: 'flex',
                        gap: 6,
                    }}
                >
                    <Link href="/hackathons" className="hover:text-foreground">
                        /hackathons
                    </Link>
                    <span style={{ opacity: 0.6 }}>/</span>
                    <span style={{ color: '#A1A1A1' }}>{event.slug}</span>
                </nav>

                {/* ─── Hero ─── */}
                <section style={{ marginBottom: 56 }}>
                    <CommentHeader
                        label={status.label}
                        version={`SPEC · V1.0`}
                    />
                    <div style={{ height: 18 }} />
                    <div style={{ display: 'flex', alignItems: 'stretch', gap: 14, marginBottom: 16 }}>
                        <div style={{ width: 2, background: '#EDEDED', flexShrink: 0 }} />
                        <h1
                            className="font-mono"
                            style={{
                                fontSize: 36,
                                fontWeight: 500,
                                letterSpacing: '0.01em',
                                textTransform: 'uppercase',
                                paddingTop: 2,
                                color: '#EDEDED',
                                lineHeight: 1.15,
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
                        <span style={{ color: '#EDEDED', letterSpacing: '0.04em' }}>
                            /{event.slug}
                        </span>
                        <span style={{ opacity: 0.6 }}>·</span>
                        <span>
                            {formatLong(event.starts_at)} → {formatLong(event.ends_at)}
                        </span>
                        <span style={{ opacity: 0.6 }}>·</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {event.submission_count} SUBMISSIONS
                        </span>
                    </div>

                    {event.description && (
                        <p
                            style={{
                                fontSize: 16,
                                lineHeight: 1.65,
                                color: '#EDEDED',
                                maxWidth: 760,
                                marginBottom: 24,
                            }}
                        >
                            {event.description}
                        </p>
                    )}

                    {/* Sponsor strip */}
                    {event.sponsors.length > 0 && (
                        <div style={{ marginTop: 18 }}>
                            <div
                                className="font-mono"
                                style={{
                                    fontSize: 10,
                                    color: TEXT_DIM,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                    marginBottom: 10,
                                }}
                            >
                                ▶ SPONSORED BY
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {event.sponsors.map((s) => (
                                    <SponsorChip key={s.name} name={s.name} prize={s.prize} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* CTA cluster */}
                    <div
                        style={{
                            marginTop: 28,
                            display: 'flex',
                            gap: 12,
                            flexWrap: 'wrap',
                        }}
                    >
                        <Link
                            href={`/hackathons/${event.slug}/join`}
                            className="font-mono"
                            style={{
                                display: 'inline-block',
                                padding: '12px 22px',
                                background: CLAY,
                                color: '#FFFFFF',
                                fontSize: 12,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                textDecoration: 'none',
                                border: `1px solid ${CLAY}`,
                            }}
                        >
                            Join with access code →
                        </Link>
                        {event.is_published && (
                            <a
                                href="#leaderboard"
                                className="font-mono"
                                style={{
                                    display: 'inline-block',
                                    padding: '12px 22px',
                                    background: 'transparent',
                                    color: '#EDEDED',
                                    fontSize: 12,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                    textDecoration: 'none',
                                    border: '1px solid rgba(255,255,255,0.10)',
                                }}
                            >
                                View leaderboard
                            </a>
                        )}
                    </div>
                </section>

                <Hairline />

                {/* ─── Rules / Judging ─── */}
                <section style={{ marginTop: 36, marginBottom: 56 }}>
                    <CommentHeader label="RULES" version="JUDGING_CRITERIA" />
                    <div style={{ height: 14 }} />
                    <Hairline />
                    <div style={{ paddingTop: 22 }}>
                        {event.rules_text ? (
                            <pre
                                style={{
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    fontSize: 14,
                                    lineHeight: 1.7,
                                    color: '#EDEDED',
                                    fontFamily: 'inherit',
                                    margin: 0,
                                }}
                            >
                                {event.rules_text}
                            </pre>
                        ) : (
                            <p
                                className="font-mono text-muted-foreground"
                                style={{ fontSize: 12, lineHeight: 1.65 }}
                            >
                                <span style={{ color: TEXT_DIM }}>// </span>
                                Submissions are scored by DevProof&apos;s V4 audit pipeline:
                                authorship, engineering depth, code quality, and forensic
                                AI-tells signal. Sponsor matching runs automatically against
                                imported packages.
                            </p>
                        )}
                    </div>
                </section>

                {/* ─── Sponsors ─── */}
                {event.sponsors.length > 0 && (
                    <>
                        <section style={{ marginBottom: 56 }}>
                            <CommentHeader
                                label="SPONSORS"
                                version={`${String(event.sponsors.length).padStart(2, '0')}_PARTNERS`}
                            />
                            <div style={{ height: 14 }} />
                            <Hairline />
                            <div
                                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                                style={{ paddingTop: 22 }}
                            >
                                {event.sponsors.map((s) => (
                                    <div
                                        key={s.name}
                                        style={{
                                            position: 'relative',
                                            padding: '18px 22px',
                                            background: 'rgba(255,255,255,0.02)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                        }}
                                    >
                                        <CornerBrackets />
                                        <div
                                            className="font-mono"
                                            style={{
                                                fontSize: 14,
                                                color: '#EDEDED',
                                                letterSpacing: '0.04em',
                                                marginBottom: 6,
                                                textTransform: 'uppercase',
                                            }}
                                        >
                                            <span style={{ color: TEXT_DIM }}>[</span>
                                            {s.name}
                                            <span style={{ color: TEXT_DIM }}>]</span>
                                        </div>
                                        {s.prize && (
                                            <div
                                                className="font-mono"
                                                style={{
                                                    fontSize: 11,
                                                    color: CLAY,
                                                    letterSpacing: '0.04em',
                                                    fontVariantNumeric: 'tabular-nums',
                                                }}
                                            >
                                                ▶ PRIZE · {s.prize}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    </>
                )}

                {/* ─── Leaderboard ─── */}
                <section id="leaderboard" style={{ marginBottom: 56 }}>
                    <CommentHeader
                        label="LEADERBOARD"
                        version={
                            event.is_published
                                ? `PUBLISHED · TOP_${Math.min(10, leaderboard?.rankings.length ?? 0)}`
                                : 'LOCKED'
                        }
                    />
                    <div style={{ height: 14 }} />
                    <Hairline />

                    {!event.is_published || !leaderboard ? (
                        <div
                            style={{
                                position: 'relative',
                                marginTop: 22,
                                padding: '32px 26px',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                textAlign: 'center',
                            }}
                        >
                            <CornerBrackets />
                            <div
                                className="font-mono"
                                style={{
                                    fontSize: 11,
                                    color: TEXT_DIM,
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                    marginBottom: 10,
                                }}
                            >
                                ▶ STATUS · LOCKED
                            </div>
                            <p
                                className="font-mono"
                                style={{
                                    fontSize: 13,
                                    color: '#EDEDED',
                                    lineHeight: 1.7,
                                    maxWidth: 540,
                                    margin: '0 auto',
                                }}
                            >
                                Leaderboard locked until the organizer publishes results.
                            </p>
                        </div>
                    ) : (
                        <div style={{ paddingTop: 22 }}>
                            <div className="grid grid-cols-1 gap-3">
                                {leaderboard.rankings.slice(0, 10).map((r) => (
                                    <LeaderboardRow key={r.submission_id} ranking={r} />
                                ))}
                            </div>

                            {leaderboard.rankings.length === 0 && (
                                <p
                                    className="font-mono text-muted-foreground"
                                    style={{
                                        fontSize: 12,
                                        marginTop: 18,
                                        textAlign: 'center',
                                        padding: 18,
                                    }}
                                >
                                    <span style={{ color: TEXT_DIM }}>// </span>
                                    No ranked submissions yet.
                                </p>
                            )}
                        </div>
                    )}
                </section>

                {/* ─── Per-sponsor sub-leaderboards ─── */}
                {event.is_published && sponsorEntries.length > 0 && (
                    <section style={{ marginBottom: 56 }}>
                        <CommentHeader
                            label="SPONSOR_TRACKS"
                            version={`${String(sponsorEntries.length).padStart(2, '0')}_TRACKS`}
                        />
                        <div style={{ height: 14 }} />
                        <Hairline />
                        <div style={{ paddingTop: 22, display: 'grid', gap: 28 }}>
                            {sponsorEntries.map(([sponsorName, entries]) => {
                                // Hydrate sponsor sub-rankings into LeaderboardRanking
                                // shape using the top-level rankings as a lookup.
                                const lookup = new Map(
                                    leaderboard?.rankings.map((r) => [r.submission_id, r]) ??
                                        []
                                );
                                const top3 = entries.slice(0, 3);

                                return (
                                    <div key={sponsorName}>
                                        <div
                                            className="font-mono"
                                            style={{
                                                fontSize: 11,
                                                color: TEXT_DIM,
                                                letterSpacing: '0.12em',
                                                textTransform: 'uppercase',
                                                marginBottom: 12,
                                                display: 'flex',
                                                gap: 8,
                                                alignItems: 'baseline',
                                            }}
                                        >
                                            <span style={{ color: CLAY }}>▶ TRACK</span>
                                            <span style={{ opacity: 0.6 }}>·</span>
                                            <span style={{ color: '#A1A1A1' }}>{sponsorName}</span>
                                        </div>
                                        <div className="grid grid-cols-1 gap-3">
                                            {top3.map((entry) => {
                                                const fullRanking = lookup.get(entry.submission_id);
                                                if (fullRanking) {
                                                    return (
                                                        <LeaderboardRow
                                                            key={entry.submission_id}
                                                            ranking={{
                                                                ...fullRanking,
                                                                rank: entry.rank,
                                                            }}
                                                            compact
                                                        />
                                                    );
                                                }
                                                // Fallback: synthesize a minimal ranking from
                                                // the sub-leaderboard entry if the parent
                                                // rankings list didn't include it (top-N cutoff).
                                                return (
                                                    <LeaderboardRow
                                                        key={entry.submission_id}
                                                        ranking={{
                                                            rank: entry.rank,
                                                            submission_id: entry.submission_id,
                                                            submitter_username: '—',
                                                            team_members: [],
                                                            github_url: '#',
                                                            repo_score: entry.repo_score,
                                                            repo_tier: null,
                                                            matched_sponsors: { [sponsorName]: 1 },
                                                        }}
                                                        compact
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ─── Embed badge ─── */}
                <section style={{ marginBottom: 40 }}>
                    <CommentHeader label="EMBED" version="ORGANIZER_BADGE" />
                    <div style={{ height: 14 }} />
                    <Hairline />
                    <div style={{ paddingTop: 22 }}>
                        <HackathonBadge
                            slug={event.slug}
                            siteOrigin={SITE_ORIGIN}
                            hackathonName={event.name}
                        />
                    </div>
                </section>

                {/* ─── Verified ribbon ─── */}
                <div
                    className="font-mono"
                    style={{
                        marginTop: 32,
                        padding: '14px 18px',
                        border: '1px solid rgba(255,255,255,0.06)',
                        background: 'rgba(255,255,255,0.02)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 10,
                        fontSize: 11,
                        letterSpacing: '0.06em',
                        color: TEXT_DIM,
                    }}
                >
                    <span>
                        <span style={{ color: CLAY }}>● </span>
                        VERIFIED BY DEVPROOF
                    </span>
                    <span>
                        <Link
                            href="/methodology"
                            style={{ color: '#A1A1A1', textDecoration: 'underline' }}
                        >
                            how scoring works →
                        </Link>
                    </span>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
}
