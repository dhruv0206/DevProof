/**
 * `/hackathons/[slug]/leaderboard` — standalone public leaderboard.
 *
 * A focused, shareable view of the rankings — same data the inline
 * leaderboard on the event page shows, but at its own clean URL so
 * it's easier to:
 *   - share in Slack/Twitter without screenshotting
 *   - embed on a sponsor's site
 *   - link from announcement emails
 *
 * Server-rendered. No auth required.  Falls back to a friendly
 * "leaderboard locked" view when the organizer hasn't published yet.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LandingNavbar } from '@/components/landing/LandingNavbar';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { LeaderboardRow } from '@/components/hackathons/LeaderboardRow';
import type {
    HackathonDetail,
    LeaderboardResponse,
} from '@/lib/types/hackathon';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';
const CORNER = 'rgba(255,255,255,0.18)';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://devproof.com';


async function fetchHackathon(slug: string): Promise<HackathonDetail | null> {
    try {
        const res = await fetch(
            `${API_URL}/api/hackathons/${encodeURIComponent(slug)}`,
            { next: { revalidate: 60 } },
        );
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
            { next: { revalidate: 60 } },
        );
        if (!res.ok) return null;
        return (await res.json()) as LeaderboardResponse;
    } catch {
        return null;
    }
}


export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const event = await fetchHackathon(slug);
    if (!event) {
        return {
            title: 'Leaderboard not found · DevProof',
            description: 'This hackathon does not exist on DevProof.',
        };
    }
    const description = event.is_published
        ? `Public rankings for ${event.name} — AI-verified scoring by DevProof.`
        : `Leaderboard for ${event.name} — coming soon. Verified by DevProof.`;
    return {
        title: `${event.name} · Leaderboard`,
        description,
        alternates: {
            canonical: `${SITE_ORIGIN}/hackathons/${slug}/leaderboard`,
        },
        openGraph: {
            title: `${event.name} · Leaderboard · DevProof`,
            description,
            url: `${SITE_ORIGIN}/hackathons/${slug}/leaderboard`,
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title: `${event.name} · Leaderboard · DevProof`,
            description,
        },
    };
}


function CornerBrackets() {
    const c: React.CSSProperties = {
        position: 'absolute',
        width: 10,
        height: 10,
        pointerEvents: 'none',
        borderColor: CORNER,
        borderStyle: 'solid',
        borderWidth: 0,
    };
    return (
        <>
            <span style={{ ...c, top: 0, left: 0, borderTopWidth: 1, borderLeftWidth: 1 }} />
            <span style={{ ...c, top: 0, right: 0, borderTopWidth: 1, borderRightWidth: 1 }} />
            <span style={{ ...c, bottom: 0, left: 0, borderBottomWidth: 1, borderLeftWidth: 1 }} />
            <span style={{ ...c, bottom: 0, right: 0, borderBottomWidth: 1, borderRightWidth: 1 }} />
        </>
    );
}


export default async function HackathonLeaderboardPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const event = await fetchHackathon(slug);
    if (!event) notFound();

    const leaderboard = event.is_published
        ? await fetchLeaderboard(slug)
        : null;

    const sponsorEntries = leaderboard?.sponsor_leaderboards
        ? Object.entries(leaderboard.sponsor_leaderboards)
        : [];

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <LandingNavbar />

            <main className="container mx-auto px-4 max-w-5xl pt-28 pb-20 flex-1 w-full">
                {/* Breadcrumb */}
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
                    <Link
                        href={`/hackathons/${event.slug}`}
                        className="hover:text-foreground"
                    >
                        {event.slug}
                    </Link>
                    <span style={{ opacity: 0.6 }}>/</span>
                    <span style={{ color: '#A1A1A1' }}>leaderboard</span>
                </nav>

                {/* Hero */}
                <header style={{ marginBottom: 48 }}>
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            color: TEXT_DIM,
                            textTransform: 'uppercase',
                            marginBottom: 12,
                        }}
                    >
                        LEADERBOARD
                        {event.is_published && leaderboard && (
                            <>
                                <span style={{ opacity: 0.6 }}> · </span>
                                <span>
                                    PUBLISHED · TOP_
                                    {Math.min(10, leaderboard.rankings.length)}
                                </span>
                            </>
                        )}
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'stretch',
                            gap: 14,
                            marginBottom: 16,
                        }}
                    >
                        <div
                            style={{
                                width: 2,
                                background: '#EDEDED',
                                flexShrink: 0,
                            }}
                        />
                        <h1
                            className="font-mono"
                            style={{
                                fontSize: 32,
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
                </header>

                {/* Rankings */}
                {!event.is_published || !leaderboard ? (
                    <section
                        className="relative"
                        style={{
                            border: '1px solid rgba(255,255,255,0.06)',
                            background: 'rgba(255,255,255,0.02)',
                            padding: '64px 24px',
                            textAlign: 'center',
                        }}
                    >
                        <CornerBrackets />
                        <div
                            className="font-mono"
                            style={{
                                fontSize: 10,
                                letterSpacing: '0.14em',
                                color: TEXT_DIM,
                                textTransform: 'uppercase',
                                marginBottom: 14,
                            }}
                        >
                            STATUS · LOCKED
                        </div>
                        <h2 className="text-lg font-medium mb-2">
                            Leaderboard not yet published
                        </h2>
                        <p
                            className="text-sm max-w-md mx-auto"
                            style={{ color: TEXT_DIM }}
                        >
                            The organizer hasn't published rankings yet. Check
                            back when judging closes.
                        </p>
                        <Link
                            href={`/hackathons/${event.slug}`}
                            className="mt-6 inline-block text-xs underline"
                            style={{ color: CLAY }}
                        >
                            ← Back to event page
                        </Link>
                    </section>
                ) : leaderboard.rankings.length === 0 ? (
                    <section
                        className="relative"
                        style={{
                            border: '1px solid rgba(255,255,255,0.06)',
                            background: 'rgba(255,255,255,0.02)',
                            padding: '64px 24px',
                            textAlign: 'center',
                        }}
                    >
                        <CornerBrackets />
                        <h2 className="text-lg font-medium mb-2">
                            No submissions
                        </h2>
                        <p
                            className="text-sm"
                            style={{ color: TEXT_DIM }}
                        >
                            // no entries on this leaderboard
                        </p>
                    </section>
                ) : (
                    <section style={{ marginBottom: 56 }}>
                        <div className="grid gap-3">
                            {leaderboard.rankings.map((r) => (
                                <LeaderboardRow
                                    key={r.submission_id}
                                    ranking={r}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* Sponsor sub-boards */}
                {sponsorEntries.length > 0 && (
                    <section style={{ marginBottom: 40 }}>
                        <div
                            className="font-mono"
                            style={{
                                fontSize: 10,
                                letterSpacing: '0.12em',
                                color: TEXT_DIM,
                                textTransform: 'uppercase',
                                marginBottom: 18,
                            }}
                        >
                            SPONSOR · LEADERBOARDS
                        </div>
                        <div className="grid gap-8">
                            {sponsorEntries.map(([sponsor, subRankings]) => {
                                const indexByPrimary = new Map(
                                    leaderboard?.rankings.map(
                                        (r) => [r.submission_id, r],
                                    ) ?? [],
                                );
                                return (
                                    <div key={sponsor}>
                                        <h3
                                            className="font-mono mb-3"
                                            style={{
                                                fontSize: 13,
                                                color: '#EDEDED',
                                                letterSpacing: '0.04em',
                                            }}
                                        >
                                            {sponsor}
                                        </h3>
                                        <div className="grid gap-2">
                                            {subRankings
                                                .slice(0, 3)
                                                .map((sr) => indexByPrimary.get(sr.submission_id))
                                                .filter(
                                                    (r): r is NonNullable<typeof r> => r !== undefined,
                                                )
                                                .map((primary) => (
                                                    <LeaderboardRow
                                                        key={primary.submission_id}
                                                        ranking={primary}
                                                        compact
                                                    />
                                                ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Footer link */}
                <div
                    className="font-mono text-xs"
                    style={{ color: TEXT_DIM, marginTop: 32 }}
                >
                    <Link
                        href={`/hackathons/${event.slug}`}
                        className="hover:text-foreground"
                    >
                        ← {event.slug} event page
                    </Link>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
}
