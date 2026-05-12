'use client';

/**
 * HackathonBadge — embeddable "Audited by DevProof" markdown snippet.
 *
 * Organizers paste this into their hackathon README to advertise that
 * submissions are audited by DevProof. The image endpoint
 * `/api/badge/hackathon/{slug}` is delivered separately; for MVP we
 * just render the markdown so it can be copied.
 */

import { useState, type CSSProperties } from 'react';
import { Check, Copy } from 'lucide-react';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

interface HackathonBadgeProps {
    slug: string;
    /**
     * Override the public site origin used in the snippet. Defaults to
     * `https://devproof.com`.
     */
    siteOrigin?: string;
    /** Hackathon display name — only used for alt text. */
    hackathonName?: string;
}

export function HackathonBadge({
    slug,
    siteOrigin = 'https://devproof.com',
    hackathonName,
}: HackathonBadgeProps) {
    const [copied, setCopied] = useState(false);

    const altText = hackathonName
        ? `Audited by DevProof — ${hackathonName}`
        : 'Audited by DevProof';

    const badgeImageUrl = `${siteOrigin}/api/badge/hackathon/${slug}`;
    const eventUrl = `${siteOrigin}/hackathons/${slug}`;
    const snippet = `[![${altText}](${badgeImageUrl})](${eventUrl})`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard API may be unavailable in some browsers/contexts.
        }
    };

    const wrap: CSSProperties = {
        position: 'relative',
        padding: '20px 22px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
    };

    const corner: CSSProperties = {
        position: 'absolute',
        width: 10,
        height: 10,
        pointerEvents: 'none',
    };

    return (
        <div style={wrap}>
            <span style={{ ...corner, top: 0, left: 0, borderTop: `1px solid rgba(255,255,255,0.18)`, borderLeft: `1px solid rgba(255,255,255,0.18)` }} />
            <span style={{ ...corner, top: 0, right: 0, borderTop: `1px solid rgba(255,255,255,0.18)`, borderRight: `1px solid rgba(255,255,255,0.18)` }} />
            <span style={{ ...corner, bottom: 0, left: 0, borderBottom: `1px solid rgba(255,255,255,0.18)`, borderLeft: `1px solid rgba(255,255,255,0.18)` }} />
            <span style={{ ...corner, bottom: 0, right: 0, borderBottom: `1px solid rgba(255,255,255,0.18)`, borderRight: `1px solid rgba(255,255,255,0.18)` }} />

            <div
                className="font-mono"
                style={{
                    fontSize: 10,
                    color: TEXT_DIM,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    justifyContent: 'space-between',
                }}
            >
                <span>EMBED · README_SNIPPET</span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="hover:text-foreground transition-colors"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 8px',
                        border: `1px solid ${copied ? CLAY : 'rgba(255,255,255,0.10)'}`,
                        background: copied ? 'rgba(204,120,92,0.08)' : 'transparent',
                        color: copied ? CLAY : TEXT_DIM,
                        fontFamily: 'inherit',
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                    }}
                >
                    {copied ? (
                        <>
                            <Check size={12} />
                            Copied
                        </>
                    ) : (
                        <>
                            <Copy size={12} />
                            Copy
                        </>
                    )}
                </button>
            </div>
            <pre
                className="font-mono"
                style={{
                    fontSize: 11,
                    color: '#EDEDED',
                    background: 'rgba(0,0,0,0.4)',
                    padding: '12px 14px',
                    border: '1px solid rgba(255,255,255,0.06)',
                    overflowX: 'auto',
                    margin: 0,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                }}
            >
                {snippet}
            </pre>
            <p
                className="font-mono"
                style={{
                    fontSize: 10,
                    color: TEXT_DIM,
                    letterSpacing: '0.04em',
                    marginTop: 12,
                    lineHeight: 1.5,
                }}
            >
                <span>// </span>
                Paste into your hackathon README to display an audit
                badge that links back to the event leaderboard.
            </p>
        </div>
    );
}
