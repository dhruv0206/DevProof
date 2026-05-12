'use client';

/**
 * Status pill for hackathon submission audit lifecycle.
 *
 * Mirrors the audit_status enum from HACKATHON_API_CONTRACTS:
 *   pending | running | complete | failed
 *
 * Mono uppercase label inside a sharp 2px hairline-bordered pill, with an
 * inline status dot. Clay only used on `complete` (the success terminal
 * state); never on running/pending so the eye is drawn to finished audits.
 */

import { Loader2 } from 'lucide-react';

export type AuditStatus = 'pending' | 'running' | 'complete' | 'failed';

const TEXT_DIM = '#666666';

export function SubmissionStatusBadge({
    status,
    className = '',
}: {
    status: AuditStatus;
    className?: string;
}) {
    const config = (() => {
        switch (status) {
            case 'pending':
                return {
                    label: 'PENDING',
                    dot: '#A1A1A1',
                    border: 'rgba(255,255,255,0.10)',
                    bg: 'transparent',
                    text: '#A1A1A1',
                    spinner: false,
                };
            case 'running':
                return {
                    label: 'RUNNING',
                    dot: '#3B82F6',
                    border: 'rgba(59,130,246,0.35)',
                    bg: 'rgba(59,130,246,0.06)',
                    text: '#93C5FD',
                    spinner: true,
                };
            case 'complete':
                return {
                    label: 'COMPLETE',
                    dot: '#CC785C',
                    border: 'rgba(204,120,92,0.35)',
                    bg: 'rgba(204,120,92,0.06)',
                    text: '#CC785C',
                    spinner: false,
                };
            case 'failed':
                return {
                    label: 'FAILED',
                    dot: '#EF4444',
                    border: 'rgba(239,68,68,0.35)',
                    bg: 'rgba(239,68,68,0.06)',
                    text: '#FCA5A5',
                    spinner: false,
                };
        }
    })();

    return (
        <span
            className={`font-mono inline-flex items-center gap-2 ${className}`}
            style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                padding: '4px 8px',
                border: `1px solid ${config.border}`,
                background: config.bg,
                color: config.text,
            }}
        >
            {config.spinner ? (
                <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
                <span
                    aria-hidden
                    style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: config.dot,
                        display: 'inline-block',
                        boxShadow: status === 'complete' ? '0 0 6px rgba(204,120,92,0.6)' : 'none',
                    }}
                />
            )}
            <span>{config.label}</span>
            <span style={{ color: TEXT_DIM, opacity: 0.6 }}>·</span>
            <span style={{ color: TEXT_DIM }}>AUDIT</span>
        </span>
    );
}
