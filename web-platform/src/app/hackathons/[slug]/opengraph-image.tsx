import { ImageResponse } from 'next/og';

/**
 * OG image for `/hackathons/[slug]` — 1200x630 social card.
 *
 * Renders the hackathon name, dates, and DevProof watermark in the
 * Clay+Geist aesthetic. Falls back to slug-only when the API is
 * unreachable so previews still work in local dev.
 */

export const runtime = 'edge';
export const alt = 'DevProof Hackathon';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const CLAY = '#CC785C';
const BG = '#0A0A0A';
const FG = '#EDEDED';
const DIM = '#666666';
const HAIRLINE = 'rgba(255,255,255,0.08)';
const CORNER = 'rgba(255,255,255,0.18)';

interface HackathonMeta {
    name?: string;
    starts_at?: string;
    ends_at?: string;
    submission_count?: number;
    is_published?: boolean;
    sponsors?: { name: string }[];
}

async function fetchMeta(slug: string): Promise<HackathonMeta | null> {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    try {
        const res = await fetch(`${apiUrl}/api/hackathons/${encodeURIComponent(slug)}`, {
            // Edge runtime — no `next: { revalidate }` on raw fetch.
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return (await res.json()) as HackathonMeta;
    } catch {
        return null;
    }
}

function formatDateRange(starts?: string, ends?: string): string {
    if (!starts || !ends) return '';
    try {
        const s = new Date(starts);
        const e = new Date(ends);
        const sameMonth =
            s.getUTCFullYear() === e.getUTCFullYear() &&
            s.getUTCMonth() === e.getUTCMonth();
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
            return `${monthFmt.format(s)} ${s.getUTCDate()}–${e.getUTCDate()}, ${e.getUTCFullYear()}`;
        }
        return `${fullFmt.format(s)} – ${fullFmt.format(e)}, ${e.getUTCFullYear()}`;
    } catch {
        return '';
    }
}

function CornerMarks() {
    const corner = {
        position: 'absolute' as const,
        width: 16,
        height: 16,
        display: 'flex',
        borderColor: CORNER,
        borderStyle: 'solid' as const,
        borderWidth: 0,
    };
    return (
        <>
            <div style={{ ...corner, top: 40, left: 40, borderTopWidth: 2, borderLeftWidth: 2 }} />
            <div style={{ ...corner, top: 40, right: 40, borderTopWidth: 2, borderRightWidth: 2 }} />
            <div style={{ ...corner, bottom: 40, left: 40, borderBottomWidth: 2, borderLeftWidth: 2 }} />
            <div style={{ ...corner, bottom: 40, right: 40, borderBottomWidth: 2, borderRightWidth: 2 }} />
        </>
    );
}

export default async function HackathonOgImage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const meta = await fetchMeta(slug);

    const name = meta?.name || slug;
    const dateRange = formatDateRange(meta?.starts_at, meta?.ends_at);
    const subCount = meta?.submission_count ?? 0;
    const sponsors = (meta?.sponsors ?? []).slice(0, 4).map((s) => s.name);
    const status = meta?.is_published
        ? 'LEADERBOARD · PUBLISHED'
        : 'LIVE EVENT';

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    background: BG,
                    color: FG,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 80,
                    position: 'relative',
                    fontFamily: '"Geist", "Helvetica Neue", system-ui, sans-serif',
                }}
            >
                <CornerMarks />

                {/* Header strip */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 18,
                        letterSpacing: 4,
                        textTransform: 'uppercase',
                        color: DIM,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ display: 'flex', color: DIM }}>{'<'}</div>
                        <div style={{ display: 'flex', color: FG }}>devproof</div>
                        <div style={{ display: 'flex', color: CLAY }}>/</div>
                        <div style={{ display: 'flex', color: DIM }}>{'>'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                background: CLAY,
                                display: 'flex',
                            }}
                        />
                        <div style={{ display: 'flex' }}>{status}</div>
                    </div>
                </div>

                {/* Body */}
                <div
                    style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        marginTop: 40,
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            fontSize: 16,
                            color: DIM,
                            letterSpacing: 4,
                            textTransform: 'uppercase',
                            marginBottom: 22,
                        }}
                    >
                        ▌HACKATHON · /{slug}
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            fontSize: 88,
                            fontWeight: 600,
                            letterSpacing: -2,
                            color: FG,
                            lineHeight: 1.05,
                            maxWidth: 1040,
                        }}
                    >
                        {name.length > 36 ? name.slice(0, 34) + '…' : name}
                    </div>

                    {dateRange && (
                        <div
                            style={{
                                display: 'flex',
                                marginTop: 28,
                                fontSize: 28,
                                color: '#A1A1A1',
                                letterSpacing: 0.5,
                            }}
                        >
                            {dateRange}
                        </div>
                    )}

                    {/* Sponsor chips */}
                    {sponsors.length > 0 && (
                        <div
                            style={{
                                display: 'flex',
                                gap: 12,
                                marginTop: 36,
                                flexWrap: 'wrap',
                            }}
                        >
                            {sponsors.map((s) => (
                                <div
                                    key={s}
                                    style={{
                                        display: 'flex',
                                        padding: '8px 16px',
                                        border: `1px solid ${HAIRLINE}`,
                                        color: FG,
                                        fontSize: 22,
                                        letterSpacing: 1,
                                    }}
                                >
                                    <div style={{ display: 'flex', color: DIM, marginRight: 6 }}>
                                        [
                                    </div>
                                    {s}
                                    <div style={{ display: 'flex', color: DIM, marginLeft: 6 }}>
                                        ]
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer strip */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 24,
                        paddingTop: 24,
                        borderTop: `1px solid ${HAIRLINE}`,
                        fontSize: 18,
                        color: DIM,
                        letterSpacing: 2,
                        textTransform: 'uppercase',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                            style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                background: CLAY,
                                display: 'flex',
                            }}
                        />
                        <div style={{ display: 'flex' }}>VERIFIED BY DEVPROOF</div>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            color: '#A1A1A1',
                            fontVariantNumeric: 'tabular-nums',
                        }}
                    >
                        {subCount} SUBMISSIONS
                    </div>
                </div>
            </div>
        ),
        {
            ...size,
        }
    );
}
