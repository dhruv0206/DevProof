/**
 * Server-rendered banner shown on /dashboard.
 *
 * Shows ONLY hackathons the logged-in dev is already part of and that are
 * currently in their submission window. Discovery is push (organizer
 * sends the join URL), not pull — we don't surface random events the
 * dev hasn't joined.
 *
 * No-op when nothing is live for the user, so logged-in devs without
 * active hackathons see no banner.
 */

import Link from 'next/link';
import { fetchMyHackathons } from '@/lib/hackathons';
import type { MyHackathonEvent } from '@/lib/types/hackathon';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

function deepLink(e: MyHackathonEvent): string {
    if (e.your_role === 'organizer' || e.your_role === 'judge') {
        return `/hackathons/${e.hackathon.slug}/admin`;
    }
    if (e.submission) return `/hackathons/${e.hackathon.slug}/me`;
    return `/hackathons/${e.hackathon.slug}/submit`;
}

function isAcceptingSubmissions(e: MyHackathonEvent): boolean {
    const now = Date.now();
    const start = e.hackathon.starts_at ? new Date(e.hackathon.starts_at).getTime() : null;
    const close = e.hackathon.submissions_close_at
        ? new Date(e.hackathon.submissions_close_at).getTime()
        : null;
    if (start === null || close === null) return false;
    return now >= start && now <= close;
}

export async function LiveHackathonsBanner() {
    const events = await fetchMyHackathons();
    if (!events || events.length === 0) return null;
    const live = events.filter(isAcceptingSubmissions);
    if (live.length === 0) return null;

    const primary = live[0];
    const extraCount = live.length - 1;

    const status = (() => {
        if (primary.your_role === 'organizer' || primary.your_role === 'judge') {
            return { label: 'YOU ORGANIZE', cta: 'OPEN ADMIN' };
        }
        if (primary.submission) return { label: 'YOU SUBMITTED', cta: 'OPEN SUBMISSION' };
        return { label: 'YOU JOINED', cta: 'SUBMIT NOW' };
    })();

    return (
        <Link
            href={deepLink(primary)}
            className="block hover:opacity-95 transition-opacity"
            style={{ textDecoration: 'none', marginBottom: 18 }}
        >
            <div
                className="font-mono"
                style={{
                    padding: '12px 16px',
                    background: 'rgba(204,120,92,0.06)',
                    border: `1px solid ${CLAY}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
                    <span style={{ color: CLAY }}>● LIVE</span>
                    <span style={{ color: '#A1A1A1', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                        {status.label}
                    </span>
                    <span style={{ color: '#EDEDED' }}>{primary.hackathon.name}</span>
                    {extraCount > 0 ? (
                        <span style={{ color: TEXT_DIM }}>+ {extraCount} more</span>
                    ) : null}
                </div>
                <span
                    style={{
                        color: CLAY,
                        fontSize: 11,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                    }}
                >
                    {status.cta} →
                </span>
            </div>
        </Link>
    );
}
