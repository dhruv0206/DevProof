/**
 * "My hackathons" section on /hackathons (logged-in view).
 *
 * Splits the user's events into Active (still in window or audit running)
 * and Past (ended). Each row deep-links to the right place — admin for
 * organizers/judges, /me for participants who've submitted, /submit for
 * participants who haven't.
 */

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { MyHackathonEvent } from '@/lib/types/hackathon';

const TEXT_DIM = '#666666';
const CORNER = 'rgba(255,255,255,0.18)';
const CLAY = '#CC785C';

function fmtDateRange(start: string | null, end: string | null) {
    if (!start || !end) return '';
    try {
        const s = new Date(start);
        const e = new Date(end);
        const fmt = new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', timeZone: 'UTC',
        });
        return `${fmt.format(s)} – ${fmt.format(e)}, ${e.getUTCFullYear()}`;
    } catch {
        return '';
    }
}

function statusBadge(e: MyHackathonEvent): { label: string; color: string } {
    if (e.your_role === 'organizer' || e.your_role === 'judge') {
        return { label: e.ended ? 'CLOSED · ADMIN' : 'LIVE · ADMIN', color: CLAY };
    }
    const sub = e.submission;
    if (!sub) {
        return { label: e.ended ? 'NO_SUBMISSION' : 'JOINED · PENDING_SUBMIT', color: '#A1A1A1' };
    }
    if (sub.audit_status === 'pending' || sub.audit_status === 'running') {
        return { label: 'AUDIT · RUNNING', color: '#F59E0B' };
    }
    if (sub.audit_status === 'failed') {
        return { label: 'AUDIT · FAILED', color: '#FCA5A5' };
    }
    if (sub.score_visible) {
        return { label: `SCORE · ${sub.repo_score ?? '—'}`, color: '#22c55e' };
    }
    return { label: 'COMPLETE · RESULTS_PENDING', color: '#22c55e' };
}

function deepLink(e: MyHackathonEvent): string {
    if (e.your_role === 'organizer' || e.your_role === 'judge') {
        return `/hackathons/${e.hackathon.slug}/admin`;
    }
    if (e.submission) return `/hackathons/${e.hackathon.slug}/me`;
    return `/hackathons/${e.hackathon.slug}/submit`;
}

function EventRow({ e }: { e: MyHackathonEvent }) {
    const badge = statusBadge(e);
    const dates = fmtDateRange(e.hackathon.starts_at, e.hackathon.ends_at);
    return (
        <Link
            href={deepLink(e)}
            className="block hover:opacity-95 transition-opacity"
            style={{ textDecoration: 'none' }}
        >
            <article
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

                <div
                    className="font-mono"
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        marginBottom: 10,
                    }}
                >
                    <span style={{ color: badge.color }}>● {badge.label}</span>
                    <span style={{ color: TEXT_DIM }}>{(e.your_role ?? 'viewer').toUpperCase()}</span>
                </div>
                <h3
                    className="font-mono"
                    style={{
                        fontSize: 16,
                        color: '#EDEDED',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                        fontWeight: 500,
                        marginBottom: 6,
                    }}
                >
                    {e.hackathon.name}
                </h3>
                <div
                    className="font-mono"
                    style={{ fontSize: 11, color: TEXT_DIM, letterSpacing: '0.04em', marginBottom: 8 }}
                >
                    /{e.hackathon.slug}
                    {dates ? <span style={{ opacity: 0.6 }}> · {dates}</span> : null}
                </div>
                <div
                    className="font-mono"
                    style={{
                        marginTop: 8,
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
                    <span>OPEN →</span>
                    <ExternalLink className="h-3 w-3" />
                </div>
            </article>
        </Link>
    );
}

export function MyHackathonsSection({ events }: { events: MyHackathonEvent[] }) {
    if (events.length === 0) return null;
    const active = events.filter((e) => !e.ended);
    const past = events.filter((e) => e.ended);

    return (
        <section style={{ marginBottom: 36 }}>
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
                <span>YOUR HACKATHONS</span>
                <span style={{ opacity: 0.6 }}>·</span>
                <span style={{ color: '#A1A1A1', fontVariantNumeric: 'tabular-nums' }}>
                    {String(events.length).padStart(2, '0')}
                </span>
            </div>

            {active.length > 0 ? (
                <>
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            color: '#A1A1A1',
                            textTransform: 'uppercase',
                            marginBottom: 10,
                        }}
                    >
                        ACTIVE
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ marginBottom: 22 }}>
                        {active.map((e) => <EventRow key={e.hackathon.slug} e={e} />)}
                    </div>
                </>
            ) : null}

            {past.length > 0 ? (
                <>
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            color: '#A1A1A1',
                            textTransform: 'uppercase',
                            marginBottom: 10,
                        }}
                    >
                        PAST
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {past.map((e) => <EventRow key={e.hackathon.slug} e={e} />)}
                    </div>
                </>
            ) : null}
        </section>
    );
}
