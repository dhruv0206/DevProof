'use client';

/**
 * TracksOptOutControl — dev-side toggle on /hackathons/[slug]/me.
 *
 * Shows every sponsor whose package was detected in the submission's code
 * (auto-matched via the V4 audit), with a checkbox per sponsor:
 *
 *   - Checked   = competing for this track (default).
 *   - Unchecked = opted out — this submission won't appear on that sponsor's
 *                 leaderboard. Overall score is unchanged.
 *
 * Persists to /submissions PATCH via the existing extras endpoint with the
 * new `tracks_opted_out` array. Read-only when submissions are locked or
 * the audit hasn't completed yet (no matches to show, no decisions to make).
 */

import { useEffect, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

interface Props {
    slug: string;
    submissionId: string;
    isEditor: boolean;
    submissionsLocked: boolean;
}

interface SubmissionLoad {
    matched_sponsors: Record<string, number>;
    tracks_opted_out: string[];
    audit_status: string;
}

export function TracksOptOutControl({
    slug,
    submissionId,
    isEditor,
    submissionsLocked,
}: Props) {
    const [data, setData] = useState<SubmissionLoad | null>(null);
    const [optedOut, setOptedOut] = useState<Set<string>>(new Set());
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [savedFlash, setSavedFlash] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}`,
                    { cache: 'no-store' },
                );
                if (!res.ok) return;
                const body = (await res.json()) as SubmissionLoad;
                if (cancelled) return;
                setData(body);
                setOptedOut(new Set(body.tracks_opted_out || []));
            } catch {
                // silent — section just won't render
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [slug, submissionId]);

    const toggle = (sponsor: string, willCompete: boolean) => {
        const next = new Set(optedOut);
        if (willCompete) next.delete(sponsor);
        else next.add(sponsor);
        setOptedOut(next);
        setError(null);

        const payload = { tracks_opted_out: Array.from(next) };
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setError(
                        typeof body?.detail === 'string'
                            ? body.detail
                            : `Save failed (HTTP ${res.status})`,
                    );
                    // Roll back local state on error
                    setOptedOut(new Set(data?.tracks_opted_out || []));
                    return;
                }
                setSavedFlash(true);
                setTimeout(() => setSavedFlash(false), 1200);
            } catch {
                setError('Network error.');
                setOptedOut(new Set(data?.tracks_opted_out || []));
            }
        });
    };

    if (!data) return null;
    const sponsorEntries = Object.entries(data.matched_sponsors || {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => a[0].localeCompare(b[0]));
    if (sponsorEntries.length === 0) {
        return null; // nothing to opt out of yet
    }

    return (
        <div
            className="rounded-md border p-5 space-y-3"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
        >
            <div
                className="font-mono"
                style={{
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    color: TEXT_DIM,
                    textTransform: 'uppercase',
                }}
            >
                ▌SPONSOR_TRACKS
                <span style={{ color: '#A1A1A1', marginLeft: 10, textTransform: 'none', letterSpacing: 'normal' }}>
                    Compete for these tracks?
                </span>
            </div>
            <p
                className="font-mono"
                style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.5 }}
            >
                <span style={{ color: TEXT_DIM }}>// </span>
                We auto-detect sponsor packages your audit found. Uncheck any
                you don&apos;t want to compete for — those sponsor leaderboards
                will exclude your submission. Your overall score doesn&apos;t change.
            </p>
            <ul className="space-y-1.5">
                {sponsorEntries.map(([sponsor, count]) => {
                    const isOptedOut = optedOut.has(sponsor);
                    return (
                        <li
                            key={sponsor}
                            className="flex items-center justify-between gap-2"
                        >
                            <label
                                className="font-mono flex items-center gap-2 cursor-pointer"
                                style={{ fontSize: 12 }}
                            >
                                <input
                                    type="checkbox"
                                    checked={!isOptedOut}
                                    onChange={(e) => toggle(sponsor, e.target.checked)}
                                    disabled={!isEditor || submissionsLocked || pending}
                                    style={{ accentColor: CLAY }}
                                />
                                <span style={{ color: '#EDEDED' }}>{sponsor}</span>
                                <span style={{ color: TEXT_DIM, fontSize: 11 }}>
                                    · {count} claim{count === 1 ? '' : 's'}
                                </span>
                            </label>
                            {isOptedOut && (
                                <span
                                    style={{
                                        fontSize: 10,
                                        letterSpacing: '0.08em',
                                        color: TEXT_DIM,
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    OPTED_OUT
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
            {pending && (
                <div className="flex items-center gap-2" style={{ fontSize: 11, color: TEXT_DIM }}>
                    <Loader2 className="h-3 w-3 animate-spin" /> saving…
                </div>
            )}
            {savedFlash && (
                <div style={{ fontSize: 11, color: CLAY }}>saved</div>
            )}
            {error && (
                <div
                    className="font-mono"
                    style={{ fontSize: 11, color: '#FCA5A5' }}
                >
                    {error}
                </div>
            )}
            {(!isEditor || submissionsLocked) && (
                <p style={{ fontSize: 10, color: TEXT_DIM, fontFamily: 'monospace' }}>
                    {!isEditor
                        ? '// only the submitter or accepted teammates can change tracks'
                        : '// submissions are locked — tracks are final'}
                </p>
            )}
        </div>
    );
}
