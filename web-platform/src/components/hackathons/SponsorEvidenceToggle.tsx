'use client';

/**
 * Organizer-only toggle for the per-hackathon `show_sponsor_evidence`
 * setting. When on, the submission-detail page shows file:line refs
 * of where each sponsor's packages are used in the audited code.
 * Score is unaffected either way.
 */

import { useState, useTransition } from 'react';

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';
const BORDER = 'rgba(255,255,255,0.08)';

interface Props {
    slug: string;
    initial: boolean;
}

export function SponsorEvidenceToggle({ slug, initial }: Props) {
    const [enabled, setEnabled] = useState(initial);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const handleToggle = () => {
        const next = !enabled;
        setEnabled(next); // optimistic
        setError(null);
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/${encodeURIComponent(slug)}/admin/settings/sponsor-evidence`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ show_sponsor_evidence: next }),
                    },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(
                        (body?.detail as string) || `Save failed (HTTP ${res.status})`,
                    );
                }
            } catch (e) {
                // Revert on failure
                setEnabled(!next);
                setError((e as Error).message || 'Network error');
            }
        });
    };

    return (
        <div
            className="rounded-lg border p-5 mb-6"
            style={{ borderColor: BORDER }}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h3 className="text-sm font-medium mb-1">
                        Show sponsor evidence on judging detail
                    </h3>
                    <p className="text-xs" style={{ color: TEXT_DIM, lineHeight: 1.55 }}>
                        When on, organizers and judges viewing a submission's audit
                        detail see exactly <em>where</em> each sponsor's packages are
                        used in the code (file:line refs). The audit score is not
                        affected. Default: off.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleToggle}
                    disabled={pending}
                    className="rounded px-4 py-2 text-xs font-medium flex-shrink-0"
                    style={{
                        background: enabled ? CLAY : 'transparent',
                        border: `1px solid ${enabled ? CLAY : BORDER}`,
                        color: enabled ? '#fff' : '#EDEDED',
                        cursor: pending ? 'wait' : 'pointer',
                        minWidth: 84,
                    }}
                >
                    {pending ? '…' : enabled ? '✓ On' : 'Off'}
                </button>
            </div>
            {error && (
                <p className="text-xs mt-3" style={{ color: '#ef4444' }}>
                    {error}
                </p>
            )}
        </div>
    );
}
