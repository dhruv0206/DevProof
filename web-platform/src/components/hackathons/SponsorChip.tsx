/**
 * SponsorChip — small mono chip with sponsor name and optional prize.
 *
 * Visual: `[sponsor_name]` rendered in geist-mono. When a prize is
 * supplied it's appended in dim mono after a center-dot. Used on the
 * public hackathon page and on browse-all rows.
 */

import type { CSSProperties } from 'react';

const TEXT_DIM = '#666666';

interface SponsorChipProps {
    name: string;
    prize?: string | null;
    /**
     * Visual size variant.
     * - `sm` — used on browse-list rows where sponsors are secondary info.
     * - `md` — used on the hackathon detail page hero / sponsor section.
     */
    size?: 'sm' | 'md';
}

export function SponsorChip({ name, prize, size = 'md' }: SponsorChipProps) {
    const padY = size === 'sm' ? 3 : 5;
    const padX = size === 'sm' ? 8 : 10;
    const fontSize = size === 'sm' ? 10 : 11;

    const wrap: CSSProperties = {
        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
        fontSize,
        letterSpacing: '0.04em',
        padding: `${padY}px ${padX}px`,
        border: '1px solid rgba(255,255,255,0.10)',
        background: 'transparent',
        color: '#EDEDED',
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        whiteSpace: 'nowrap',
    };

    return (
        <span style={wrap}>
            <span style={{ color: TEXT_DIM }}>[</span>
            <span style={{ letterSpacing: '0.02em' }}>{name}</span>
            <span style={{ color: TEXT_DIM }}>]</span>
            {prize ? (
                <>
                    <span style={{ color: TEXT_DIM, opacity: 0.7 }}>·</span>
                    <span style={{ color: TEXT_DIM, fontVariantNumeric: 'tabular-nums' }}>
                        {prize}
                    </span>
                </>
            ) : null}
        </span>
    );
}
