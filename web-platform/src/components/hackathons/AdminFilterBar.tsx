'use client';

import { useState } from 'react';
import type { AuditStatus } from '@/lib/types/hackathon';

const TEXT_DIM = '#666666';

export type SortKey = 'score_desc' | 'recent';

export interface FilterState {
    status: AuditStatus | 'all';
    sort: SortKey;
    search: string;
}

interface AdminFilterBarProps {
    value: FilterState;
    onChange: (next: FilterState) => void;
    counts?: {
        total: number;
        complete: number;
        running: number;
        failed: number;
    };
}

const STATUS_OPTIONS: { value: FilterState['status']; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'complete', label: 'Complete' },
    { value: 'running', label: 'Running' },
    { value: 'pending', label: 'Pending' },
    { value: 'failed', label: 'Failed' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'score_desc', label: 'Score · desc' },
    { value: 'recent', label: 'Most recent' },
];

export function AdminFilterBar({ value, onChange, counts }: AdminFilterBarProps) {
    const [searchDraft, setSearchDraft] = useState(value.search);

    const commitSearch = () => {
        if (searchDraft !== value.search) {
            onChange({ ...value, search: searchDraft });
        }
    };

    return (
        <div
            className="font-mono"
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 16,
                padding: '14px 16px',
                background: 'rgba(255,255,255,0.015)',
                border: '1px solid rgba(255,255,255,0.06)',
                marginBottom: 16,
            }}
        >
            {/* Status segmented buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                    }}
                >
                    Status
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                    {STATUS_OPTIONS.map((opt) => {
                        const active = value.status === opt.value;
                        let count: number | undefined;
                        if (counts) {
                            if (opt.value === 'all') count = counts.total;
                            else if (opt.value === 'complete') count = counts.complete;
                            else if (opt.value === 'running') count = counts.running;
                            else if (opt.value === 'failed') count = counts.failed;
                        }
                        return (
                            <button
                                key={opt.value}
                                onClick={() =>
                                    onChange({ ...value, status: opt.value })
                                }
                                style={{
                                    padding: '4px 10px',
                                    fontSize: 11,
                                    letterSpacing: '0.04em',
                                    color: active ? '#EDEDED' : '#A1A1A1',
                                    background: active
                                        ? 'rgba(204,120,92,0.10)'
                                        : 'transparent',
                                    border: `1px solid ${active ? 'var(--clay)' : 'rgba(255,255,255,0.08)'}`,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                }}
                            >
                                {opt.label}
                                {count !== undefined && (
                                    <span
                                        style={{
                                            color: active ? 'var(--clay)' : TEXT_DIM,
                                            marginLeft: 6,
                                            fontVariantNumeric: 'tabular-nums',
                                        }}
                                    >
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Sort */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                    }}
                >
                    Sort
                </span>
                <select
                    value={value.sort}
                    onChange={(e) =>
                        onChange({ ...value, sort: e.target.value as SortKey })
                    }
                    className="font-mono"
                    style={{
                        padding: '4px 8px',
                        fontSize: 11,
                        letterSpacing: '0.04em',
                        color: '#EDEDED',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        cursor: 'pointer',
                    }}
                >
                    {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* Search */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginLeft: 'auto',
                }}
            >
                <span
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                    }}
                >
                    Search
                </span>
                <input
                    type="text"
                    placeholder="username..."
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onBlur={commitSearch}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commitSearch();
                    }}
                    className="font-mono"
                    style={{
                        padding: '4px 10px',
                        fontSize: 11,
                        letterSpacing: '0.04em',
                        color: '#EDEDED',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        outline: 'none',
                        width: 180,
                    }}
                />
            </div>
        </div>
    );
}
