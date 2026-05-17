'use client';

/**
 * SubmissionLockControl — organizer-only widget on /admin to control the
 * submission edit window. Two controls in one card:
 *
 *   1. Lock now / Unlock — instant manual override of submissions_locked_override.
 *      Useful when judging starts ahead of schedule, or when extending past
 *      the scheduled close.
 *   2. Scheduled close — datetime-local input for submissions_close_at.
 *      Defaults to ends_at if the organizer never sets it explicitly.
 *
 * The effective lock state (computed server-side: override OR past-close)
 * is shown as a status pill so the organizer sees current behavior.
 */

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

interface Props {
    slug: string;
    initialLockedOverride: boolean;
    initialCloseAt: string | null;
    initialLockedEffective: boolean;
}

export function SubmissionLockControl({
    slug,
    initialLockedOverride,
    initialCloseAt,
    initialLockedEffective,
}: Props) {
    const [lockedOverride, setLockedOverride] = useState(initialLockedOverride);
    const [closeAt, setCloseAt] = useState(initialCloseAt);
    const [lockedEffective, setLockedEffective] = useState(initialLockedEffective);
    const [dirty, setDirty] = useState(false);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const persist = (payload: { locked_override?: boolean; submissions_close_at?: string | null }) => {
        setError(null);
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/${encodeURIComponent(slug)}/admin/settings/submission-lock`,
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
                    return;
                }
                const data = (await res.json()) as {
                    locked_override: boolean;
                    submissions_close_at: string | null;
                    submissions_locked_effective: boolean;
                };
                setLockedOverride(data.locked_override);
                setCloseAt(data.submissions_close_at);
                setLockedEffective(data.submissions_locked_effective);
                setDirty(false);
            } catch {
                setError('Network error.');
            }
        });
    };

    const toggleOverride = () => persist({ locked_override: !lockedOverride });
    const saveCloseAt = () => {
        // Convert datetime-local back to ISO with Z suffix.
        const iso = closeAt ? new Date(closeAt).toISOString() : null;
        persist({ submissions_close_at: iso });
    };

    // datetime-local needs "YYYY-MM-DDTHH:mm" (no seconds, no Z).
    const localValue = closeAt ? new Date(closeAt).toISOString().slice(0, 16) : '';

    return (
        <div
            className="font-mono"
            style={{
                marginTop: 18,
                padding: '14px 16px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.10)',
                display: 'grid',
                gap: 14,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                    <div
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            color: TEXT_DIM,
                            textTransform: 'uppercase',
                            marginBottom: 4,
                        }}
                    >
                        Submission window
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                            style={{
                                fontSize: 10,
                                letterSpacing: '0.08em',
                                padding: '3px 8px',
                                textTransform: 'uppercase',
                                color: lockedEffective ? '#FCA5A5' : '#00FF41',
                                border: `1px solid ${lockedEffective ? 'rgba(252,165,165,0.40)' : 'rgba(0,255,65,0.40)'}`,
                                background: lockedEffective
                                    ? 'rgba(239,68,68,0.08)'
                                    : 'rgba(0,255,65,0.05)',
                            }}
                        >
                            {lockedEffective ? 'LOCKED' : 'OPEN'}
                        </span>
                        <span style={{ fontSize: 11, color: TEXT_DIM }}>
                            {lockedOverride
                                ? 'Manual lock is on'
                                : closeAt
                                    ? `Auto-locks ${new Date(closeAt).toLocaleString()}`
                                    : 'No scheduled close set'}
                        </span>
                    </div>
                </div>
                <Button
                    type="button"
                    onClick={toggleOverride}
                    disabled={pending}
                    variant={lockedOverride ? 'default' : 'outline'}
                    size="sm"
                >
                    {pending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    {lockedOverride ? 'Unlock now' : 'Lock now'}
                </Button>
            </div>

            <div
                style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-end',
                    flexWrap: 'wrap',
                }}
            >
                <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            color: TEXT_DIM,
                            textTransform: 'uppercase',
                        }}
                    >
                        Scheduled close (auto-lock)
                    </label>
                    <input
                        type="datetime-local"
                        step={60}
                        value={localValue}
                        onChange={(e) => {
                            setCloseAt(e.target.value ? new Date(e.target.value).toISOString() : null);
                            setDirty(true);
                        }}
                        onClick={(e) => {
                            // showPicker() opens the platform datetime picker
                            // anywhere on the field, not just on the small icon.
                            const el = e.currentTarget as HTMLInputElement & {
                                showPicker?: () => void;
                            };
                            el.showPicker?.();
                        }}
                        disabled={pending}
                        style={{
                            background: 'rgba(0,0,0,0.25)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: '#EDEDED',
                            padding: '6px 10px',
                            fontSize: 13,
                            fontFamily: 'inherit',
                            colorScheme: 'dark',
                            cursor: 'pointer',
                        }}
                    />
                </div>
                <Button
                    type="button"
                    onClick={saveCloseAt}
                    disabled={pending || !dirty}
                    variant="outline"
                    size="sm"
                    style={{ color: dirty ? CLAY : undefined }}
                >
                    {pending ? 'Saving…' : 'Save'}
                </Button>
            </div>

            {error && (
                <p style={{ fontSize: 11, color: '#FCA5A5' }}>{error}</p>
            )}
        </div>
    );
}
