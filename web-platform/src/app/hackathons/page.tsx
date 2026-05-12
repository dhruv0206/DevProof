import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { LandingNavbar } from '@/components/landing/LandingNavbar';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SponsorChip } from '@/components/hackathons/SponsorChip';
import { MyHackathonsSection } from '@/components/hackathons/MyHackathonsSection';
import { fetchMyHackathons } from '@/lib/hackathons';
import type {
    HackathonListItem,
    HackathonListResponse,
    MyHackathonEvent,
} from '@/lib/types/hackathon';

/**
 * `/hackathons` — Public browse-all page.
 *
 * Fetches `GET /api/hackathons` (NOT in the contracts doc; Track A may
 * not deliver this for MVP). On 404 / failure we render an empty
 * "no events live yet" state — the page still renders cleanly for
 * SEO crawlers.
 */

export const metadata: Metadata = {
    title: 'Hackathons',
    description:
        'Browse hackathons audited by DevProof. AI-verified judging, sponsor matching, and public leaderboards for every event.',
    openGraph: {
        title: 'Hackathons · DevProof',
        description:
            'Browse hackathons audited by DevProof. AI-verified judging and public leaderboards.',
    },
};

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

async function fetchHackathons(): Promise<HackathonListItem[]> {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    try {
        const res = await fetch(`${apiUrl}/api/hackathons`, {
            next: { revalidate: 60 },
        });
        if (!res.ok) return [];
        const data = (await res.json()) as HackathonListResponse | HackathonListItem[];
        // Tolerate both `{hackathons: [...]}` and a bare array — backend is
        // not yet pinned to a shape.
        if (Array.isArray(data)) return data;
        return data.hackathons ?? [];
    } catch {
        return [];
    }
}

function formatDateRange(startsAt: string, endsAt: string): string {
    try {
        const start = new Date(startsAt);
        const end = new Date(endsAt);
        const sameMonth =
            start.getUTCFullYear() === end.getUTCFullYear() &&
            start.getUTCMonth() === end.getUTCMonth();

        const monthFmt = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            timeZone: 'UTC',
        });
        const fullFmt = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
        });

        if (sameMonth) {
            return `${monthFmt.format(start)} ${start.getUTCDate()}–${end.getUTCDate()}, ${end.getUTCFullYear()}`;
        }
        return `${fullFmt.format(start)} – ${fullFmt.format(end)}, ${end.getUTCFullYear()}`;
    } catch {
        return '';
    }
}

function eventStatus(item: HackathonListItem): {
    label: string;
    statusOk: boolean;
} {
    const now = Date.now();
    const start = new Date(item.starts_at).getTime();
    const end = new Date(item.ends_at).getTime();
    const close = new Date(item.submissions_close_at).getTime();

    if (Number.isNaN(start) || Number.isNaN(end)) {
        return { label: 'TBD', statusOk: false };
    }
    if (now < start) return { label: 'UPCOMING', statusOk: false };
    if (now <= close) return { label: 'LIVE · ACCEPTING', statusOk: true };
    if (now <= end) return { label: 'JUDGING', statusOk: true };
    if (item.is_published) return { label: 'PUBLISHED', statusOk: true };
    return { label: 'CLOSED', statusOk: false };
}

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

function HackathonRow({ item }: { item: HackathonListItem }) {
    const { label, statusOk } = eventStatus(item);
    const dateRange = formatDateRange(item.starts_at, item.ends_at);
    const topSponsors = item.sponsors.slice(0, 3);
    const extraSponsors = Math.max(0, item.sponsors.length - 3);

    return (
        <Link
            href={`/hackathons/${item.slug}`}
            className="block transition-opacity hover:opacity-95"
            style={{ textDecoration: 'none' }}
        >
            <article
                style={{
                    position: 'relative',
                    padding: '24px 26px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                }}
            >
                <CornerBrackets />

                {/* Top status row */}
                <div
                    className="font-mono"
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        marginBottom: 14,
                    }}
                >
                    <span style={{ color: statusOk ? CLAY : TEXT_DIM }}>● {label}</span>
                    <span style={{ color: TEXT_DIM, fontVariantNumeric: 'tabular-nums' }}>
                        {item.submission_count} SUB
                    </span>
                </div>

                {/* Title */}
                <h2
                    className="font-mono"
                    style={{
                        fontSize: 20,
                        fontWeight: 500,
                        color: '#EDEDED',
                        letterSpacing: '0.02em',
                        marginBottom: 8,
                        textTransform: 'uppercase',
                        lineHeight: 1.25,
                    }}
                >
                    {item.name}
                </h2>

                {/* Slug + dates */}
                <div
                    className="font-mono"
                    style={{
                        fontSize: 11,
                        color: TEXT_DIM,
                        letterSpacing: '0.04em',
                        marginBottom: 16,
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'baseline',
                        gap: 8,
                    }}
                >
                    <span>/{item.slug}</span>
                    {dateRange && (
                        <>
                            <span style={{ opacity: 0.6 }}>·</span>
                            <span>{dateRange}</span>
                        </>
                    )}
                </div>

                {/* Sponsors */}
                {topSponsors.length > 0 && (
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                            alignItems: 'center',
                        }}
                    >
                        {topSponsors.map((s) => (
                            <SponsorChip key={s.name} name={s.name} prize={s.prize} size="sm" />
                        ))}
                        {extraSponsors > 0 && (
                            <span
                                className="font-mono"
                                style={{
                                    fontSize: 10,
                                    color: TEXT_DIM,
                                    letterSpacing: '0.08em',
                                }}
                            >
                                +{extraSponsors} more
                            </span>
                        )}
                    </div>
                )}

                {/* CTA hint */}
                <div
                    className="font-mono"
                    style={{
                        marginTop: 18,
                        paddingTop: 14,
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                    }}
                >
                    <span>{item.is_published ? 'VIEW LEADERBOARD' : 'VIEW EVENT'}</span>
                    <span style={{ color: '#A1A1A1' }}>→</span>
                </div>
            </article>
        </Link>
    );
}

function DevHackathonsView({ events }: { events: MyHackathonEvent[] }) {
    return (
        <main className="w-full px-8 py-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-semibold mb-1">Hackathons</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Events you&apos;re currently in and ones you&apos;ve completed.
                        DevProof audits each submission&apos;s code in hackathon mode.
                    </p>
                </div>
            </div>

            {events.length === 0 ? (
                <SignedInEmptyState />
            ) : (
                <MyHackathonsSection events={events} />
            )}
        </main>
    );
}

function SignedInEmptyState() {
    return (
        <div
            style={{
                position: 'relative',
                padding: '40px 28px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                textAlign: 'center',
            }}
        >
            <CornerBrackets />
            <div
                className="font-mono"
                style={{
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: TEXT_DIM,
                    marginBottom: 12,
                }}
            >
                STATUS · NO_HACKATHONS
            </div>
            <h2
                className="font-mono"
                style={{
                    fontSize: 20,
                    color: '#EDEDED',
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                    fontWeight: 500,
                }}
            >
                ▌YOU&apos;RE NOT IN ANY HACKATHONS YET
            </h2>
            <p
                className="font-mono"
                style={{
                    fontSize: 12,
                    color: TEXT_DIM,
                    lineHeight: 1.7,
                    maxWidth: 540,
                    margin: '0 auto',
                }}
            >
                <span>// </span>
                Hackathons are invite-only. When an organizer adds you to an event,
                they&apos;ll send a join URL + access code. Paste the code at the
                join URL and your event will show up here.
            </p>
        </div>
    );
}

function EmptyState() {
    return (
        <div
            style={{
                position: 'relative',
                padding: '48px 32px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                textAlign: 'center',
            }}
        >
            <CornerBrackets />
            <div
                className="font-mono"
                style={{
                    fontSize: 10,
                    color: TEXT_DIM,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    marginBottom: 14,
                }}
            >
                STATUS · 00 EVENTS_LIVE
            </div>
            <h2
                className="font-mono"
                style={{
                    fontSize: 22,
                    color: '#EDEDED',
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                    fontWeight: 500,
                }}
            >
                ▌NO EVENTS LIVE YET
            </h2>
            <p
                className="font-mono"
                style={{
                    fontSize: 12,
                    color: TEXT_DIM,
                    lineHeight: 1.7,
                    maxWidth: 560,
                    margin: '0 auto',
                }}
            >
                <span>// </span>
                DevProof Hackathons is in private beta. Organizing a hackathon and
                want AI-verified judging? Reach out — we&apos;ll spin up your
                event in under an hour.
            </p>
            <div style={{ marginTop: 22 }}>
                <a
                    href="mailto:dhruv0128@gmail.com?subject=Hackathon%20pilot%20interest"
                    className="font-mono"
                    style={{
                        display: 'inline-block',
                        padding: '10px 18px',
                        border: `1px solid ${CLAY}`,
                        background: 'rgba(204,120,92,0.08)',
                        color: CLAY,
                        fontSize: 11,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        textDecoration: 'none',
                    }}
                >
                    Email organizers desk →
                </a>
            </div>
        </div>
    );
}

export default async function HackathonsPage() {
    // Determine auth state explicitly so we can distinguish "unauthenticated"
    // from "API call failed" — both used to make fetchMyHackathons return
    // null, which leaked the public discover list to logged-in devs when the
    // backend was unreachable.
    const session = await auth.api.getSession({ headers: await headers() });
    const isLoggedIn = Boolean(session?.user);

    const [hackathons, myEventsRaw] = await Promise.all([
        fetchHackathons(),
        isLoggedIn ? fetchMyHackathons() : Promise.resolve(null),
    ]);
    // For logged-in users, treat a null response (API failure) as empty
    // rather than falling back to the public list.
    const myEvents: typeof myEventsRaw =
        isLoggedIn ? (myEventsRaw ?? []) : null;

    // Sort: live/upcoming first, then by start date desc.
    const now = Date.now();
    const sorted = [...hackathons].sort((a, b) => {
        const aEnd = new Date(a.ends_at).getTime();
        const bEnd = new Date(b.ends_at).getTime();
        const aActive = aEnd >= now;
        const bActive = bEnd >= now;
        if (aActive !== bActive) return aActive ? -1 : 1;
        return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
    });

    // Logged-in devs get the dashboard chrome (sidebar). Logged-out
    // visitors get the public marketing chrome.
    if (isLoggedIn) {
        return (
            <DashboardLayout>
                <DevHackathonsView events={myEvents ?? []} />
            </DashboardLayout>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <LandingNavbar />

            <main className="container mx-auto px-4 max-w-5xl pt-32 pb-20 flex-1 w-full">
                {/* Header */}
                <div style={{ marginBottom: 36 }}>
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
                        <span>PUBLIC INDEX</span>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'space-between',
                            gap: 16,
                            flexWrap: 'wrap',
                            marginBottom: 18,
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'stretch', gap: 14 }}>
                            <div style={{ width: 2, background: '#EDEDED', flexShrink: 0 }} />
                            <h1
                                className="font-mono"
                                style={{
                                    fontSize: 32,
                                    fontWeight: 500,
                                    letterSpacing: '0.02em',
                                    textTransform: 'uppercase',
                                    paddingTop: 2,
                                    color: '#EDEDED',
                                }}
                            >
                                ▌HACKATHONS
                            </h1>
                        </div>
                        <Link
                            href="/host"
                            className="font-mono"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '10px 16px',
                                border: `1px solid ${CLAY}`,
                                background: 'rgba(204,120,92,0.08)',
                                color: CLAY,
                                fontSize: 11,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                textDecoration: 'none',
                            }}
                        >
                            Host a hackathon <span style={{ opacity: 0.8 }}>→</span>
                        </Link>
                    </div>
                    <p
                        className="font-mono text-muted-foreground"
                        style={{
                            fontSize: 13,
                            lineHeight: 1.7,
                            maxWidth: 720,
                        }}
                    >
                        <span style={{ color: TEXT_DIM }}>// </span>
                        AI-verified judging. Public leaderboards. Sponsor matching.
                        Every submission below was scored by the same V4 audit pipeline that
                        powers DevProof developer scores.
                    </p>
                </div>

                <div className="h-px bg-border" style={{ marginBottom: 28 }} />

                {/* Logged-out visitor: public marketing index. */}
                {sorted.length === 0 ? (
                    <EmptyState />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {sorted.map((item) => (
                            <HackathonRow key={item.slug} item={item} />
                        ))}
                    </div>
                )}

                {/* Verified ribbon */}
                <div
                    className="font-mono"
                    style={{
                        marginTop: 56,
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
                        <span style={{ opacity: 0.6 }}>// </span>
                        organizing? &nbsp;
                        <a
                            href="mailto:dhruv0128@gmail.com?subject=Hackathon%20pilot%20interest"
                            style={{ color: '#A1A1A1', textDecoration: 'underline' }}
                        >
                            email the organizers desk
                        </a>
                    </span>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
}
