/**
 * "Reissue magic link" button shown on each row of /hackathons/admin
 * when the viewer is a platform admin.
 *
 * Opens a modal that asks for email + role, posts to the narrow proxy
 * endpoint, and displays the freshly-minted magic-link URL with a
 * one-click copy button. The platform admin never enters the per-event
 * admin UI — submissions stay private from DevProof staff.
 */

'use client';

import { useState, type FormEvent } from 'react';

const CLAY = '#CC785C';
const TEXT_DIM = '#888';

interface Props {
    slug: string;
    /** Hackathon display name — used in modal copy. */
    name: string;
}

type Role = 'organizer' | 'judge' | 'observer';

export function PlatformAdminReissueButton({ slug, name }: Props) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('organizer');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [link, setLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const reset = () => {
        setEmail('');
        setRole('organizer');
        setError(null);
        setLink(null);
        setCopied(false);
    };

    const close = () => {
        setOpen(false);
        reset();
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        const res = await fetch(
            `/api/hackathons-proxy/${encodeURIComponent(slug)}/platform-reissue-invite`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), role }),
            },
        );

        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            setError(payload.detail || `HTTP ${res.status}`);
            setSubmitting(false);
            return;
        }

        const data = (await res.json()) as { magic_link?: string };
        setLink(data.magic_link ?? null);
        setSubmitting(false);
    };

    const copy = async () => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // ignore — older browsers
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(true);
                }}
                className="text-xs rounded-md px-3 py-1.5 transition-colors hover:bg-white/[0.04]"
                style={{
                    color: '#aaa',
                    border: '1px solid rgba(255,255,255,0.10)',
                }}
            >
                Reissue link
            </button>

            {open && (
                <div
                    onClick={close}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.6)',
                        zIndex: 50,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 16,
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '100%',
                            maxWidth: 480,
                            background: '#0a0a0a',
                            border: '1px solid rgba(255,255,255,0.10)',
                            padding: 24,
                            borderRadius: 8,
                        }}
                    >
                        <div
                            className="font-mono text-[10px] uppercase tracking-[0.18em] mb-2"
                            style={{ color: TEXT_DIM }}
                        >
                            REISSUE · MAGIC LINK
                        </div>
                        <h3 className="text-lg font-semibold mb-1">{name}</h3>
                        <p
                            className="text-xs mb-5"
                            style={{ color: TEXT_DIM }}
                        >
                            Mint a fresh single-use magic link for an organizer
                            or judge. Old links continue to work until used or
                            revoked.
                        </p>

                        {link ? (
                            <div className="space-y-3">
                                <label
                                    className="block text-xs font-medium"
                                    style={{ color: TEXT_DIM }}
                                >
                                    Magic link (copy &amp; send)
                                </label>
                                <input
                                    readOnly
                                    value={link}
                                    onFocus={(e) => e.currentTarget.select()}
                                    className="w-full rounded-md px-3 py-2 text-xs font-mono bg-transparent outline-none"
                                    style={{
                                        border: '1px solid rgba(255,255,255,0.10)',
                                        color: '#EDEDED',
                                    }}
                                />
                                <div className="flex gap-2 justify-end">
                                    <button
                                        type="button"
                                        onClick={copy}
                                        className="text-xs rounded-md px-3 py-1.5 transition-opacity hover:opacity-90"
                                        style={{
                                            backgroundColor: CLAY,
                                            color: '#fff',
                                        }}
                                    >
                                        {copied ? 'Copied ✓' : 'Copy'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={close}
                                        className="text-xs rounded-md px-3 py-1.5"
                                        style={{
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            color: '#aaa',
                                        }}
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-3">
                                <div>
                                    <label
                                        htmlFor="email"
                                        className="block text-xs font-medium mb-1.5"
                                        style={{ color: TEXT_DIM }}
                                    >
                                        Email
                                    </label>
                                    <input
                                        id="email"
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        disabled={submitting}
                                        className="w-full rounded-md px-3 py-2 text-sm bg-transparent outline-none"
                                        style={{
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            color: '#EDEDED',
                                        }}
                                        placeholder="organizer@example.com"
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor="role"
                                        className="block text-xs font-medium mb-1.5"
                                        style={{ color: TEXT_DIM }}
                                    >
                                        Role
                                    </label>
                                    <select
                                        id="role"
                                        value={role}
                                        onChange={(e) => setRole(e.target.value as Role)}
                                        disabled={submitting}
                                        className="w-full rounded-md px-3 py-2 text-sm outline-none"
                                        style={{
                                            background: '#111',
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            color: '#EDEDED',
                                        }}
                                    >
                                        <option value="organizer">Organizer</option>
                                        <option value="judge">Judge</option>
                                        <option value="observer">Observer</option>
                                    </select>
                                </div>

                                {error && (
                                    <div
                                        className="font-mono text-xs px-3 py-2 rounded-md"
                                        style={{
                                            color: '#fca5a5',
                                            background: 'rgba(239,68,68,0.06)',
                                            border: '1px solid rgba(239,68,68,0.25)',
                                        }}
                                    >
                                        // {error}
                                    </div>
                                )}

                                <div className="flex gap-2 justify-end pt-2">
                                    <button
                                        type="button"
                                        onClick={close}
                                        disabled={submitting}
                                        className="text-xs rounded-md px-3 py-1.5"
                                        style={{
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            color: '#aaa',
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={submitting || !email}
                                        className="text-xs rounded-md px-3 py-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
                                        style={{
                                            backgroundColor: CLAY,
                                            color: '#fff',
                                        }}
                                    >
                                        {submitting ? 'Generating…' : 'Generate link'}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
