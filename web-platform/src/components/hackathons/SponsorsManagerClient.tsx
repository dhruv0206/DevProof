'use client';

/**
 * Organizer-only sponsor management UI.
 *
 * Two modes for adding a sponsor:
 *
 *   1. Catalog mode (default) — pick a known sponsor from a typeahead
 *      list. Packages auto-fill from the curated catalog so organizers
 *      don't have to know the npm names. Editable before save in case
 *      the sponsor's package list is event-specific.
 *
 *   2. Custom mode — sponsor not in the catalog. Just type the brand
 *      name; the backend does whole-word matching of the name against
 *      each submission's imports. Packages are an optional "Advanced"
 *      field for surgical precision (e.g. sponsors with generic names).
 *
 * Persists via PUT (full-replace) to the sponsors endpoint. Optimistic
 * UI with rollback on failure.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
    SPONSOR_CATALOG,
    findCatalogEntry,
    searchCatalog,
    type SponsorCatalogEntry,
} from '@/lib/hackathons/sponsor-catalog';

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';
const BORDER = 'rgba(255,255,255,0.08)';

export interface SponsorEntry {
    name: string;
    packages: string[];
    prize?: string | null;
}

interface Props {
    slug: string;
    initial: SponsorEntry[];
}

type Mode = 'catalog' | 'custom';

export function SponsorsManagerClient({ slug, initial }: Props) {
    const [sponsors, setSponsors] = useState<SponsorEntry[]>(initial);
    const [mode, setMode] = useState<Mode>('catalog');

    // Catalog-mode state
    const [catalogQuery, setCatalogQuery] = useState('');
    const [catalogChoice, setCatalogChoice] = useState<SponsorCatalogEntry | null>(null);
    const [showSuggest, setShowSuggest] = useState(false);
    const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Custom-mode state
    const [customName, setCustomName] = useState('');
    const [customPackages, setCustomPackages] = useState('');
    const [showCustomAdvanced, setShowCustomAdvanced] = useState(false);

    // Shared state
    const [prize, setPrize] = useState('');
    const [editPackages, setEditPackages] = useState(''); // catalog-mode: editable packages
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    // Ambiguity heuristic: short names produce noisier name-match needles
    // (e.g. "Hex" matching "hexagonal-X"). Backend rejects anything <4 chars
    // outright, but anything <6 chars is worth flagging in the UI so the
    // organizer can pre-empt false positives by adding packages.
    const customNameTrim = customName.trim();
    const customNameLen = customNameTrim.replace(/\s+/g, '').length;
    const showShortNameHint = customNameTrim !== '' && customNameLen > 0 && customNameLen < 6;
    const blockedByShortName = customNameTrim !== '' && customNameLen < 4;

    // When user picks from catalog, sync editable fields
    useEffect(() => {
        if (catalogChoice) {
            setEditPackages(catalogChoice.packages.join(', '));
        }
    }, [catalogChoice]);

    const suggestions = useMemo(() => {
        const taken = new Set(sponsors.map((s) => s.name.toLowerCase()));
        return searchCatalog(catalogQuery)
            .filter((s) => !taken.has(s.name.toLowerCase()))
            .slice(0, 8);
    }, [catalogQuery, sponsors]);

    const persist = (next: SponsorEntry[]) => {
        const prev = sponsors;
        setSponsors(next);
        setError(null);
        startTransition(async () => {
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/${encodeURIComponent(slug)}/admin/sponsors`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sponsors: next }),
                    },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(
                        (body?.detail as string) || `Save failed (HTTP ${res.status})`,
                    );
                }
            } catch (e) {
                setSponsors(prev);
                setError((e as Error).message || 'Network error');
            }
        });
    };

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        let name: string;
        let packages: string[];

        if (mode === 'catalog') {
            if (!catalogChoice) {
                setError('Pick a sponsor from the list, or switch to Custom.');
                return;
            }
            name = catalogChoice.name;
            packages = editPackages
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean);
        } else {
            name = customName.trim();
            if (!name) {
                setError('Sponsor name is required.');
                return;
            }
            packages = customPackages
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean);
        }

        if (sponsors.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
            setError(`Sponsor "${name}" already exists.`);
            return;
        }

        const next = [...sponsors, { name, packages, prize: prize.trim() || null }];
        persist(next);

        // Reset form
        setCatalogQuery('');
        setCatalogChoice(null);
        setEditPackages('');
        setCustomName('');
        setCustomPackages('');
        setShowCustomAdvanced(false);
        setPrize('');
    };

    const handleRemove = (name: string) => {
        if (!confirm(`Remove sponsor "${name}"?`)) return;
        persist(sponsors.filter((s) => s.name !== name));
    };

    const handleSelectSuggestion = (entry: SponsorCatalogEntry) => {
        setCatalogChoice(entry);
        setCatalogQuery(entry.name);
        setShowSuggest(false);
    };

    return (
        <div
            className="rounded-lg border p-5 mb-6"
            style={{ borderColor: BORDER }}
        >
            <h2 className="text-lg font-medium mb-1">Sponsors</h2>
            <p className="text-xs mb-4" style={{ color: TEXT_DIM }}>
                Add a sponsor by picking from the catalog (38 known sponsors
                with package lists pre-filled) or by typing a brand name
                directly. For custom entries, the audit searches each
                submission's imports for the sponsor's name — no npm
                knowledge needed. Matches surface on the leaderboard below
                (and, when &quot;Show sponsor evidence&quot; is on, with
                file:line refs in each submission's audit detail page).
            </p>

            {/* Existing list */}
            {sponsors.length > 0 ? (
                <ul className="space-y-2 mb-5">
                    {sponsors.map((s) => (
                        <li
                            key={s.name}
                            className="rounded-md border p-3 flex items-start justify-between gap-3"
                            style={{ borderColor: BORDER }}
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                    <span className="text-sm font-medium">{s.name}</span>
                                    {s.prize && (
                                        <span className="text-xs" style={{ color: CLAY }}>
                                            {s.prize}
                                        </span>
                                    )}
                                </div>
                                <div
                                    className="text-xs mt-1 font-mono"
                                    style={{ color: TEXT_DIM }}
                                >
                                    {s.packages.length > 0 ? (
                                        s.packages.map((p) => (
                                            <code
                                                key={p}
                                                className="inline-block mr-1.5 px-1.5 py-0.5"
                                                style={{
                                                    background: 'rgba(255,255,255,0.04)',
                                                    border: '1px solid rgba(255,255,255,0.06)',
                                                }}
                                            >
                                                {p}
                                            </code>
                                        ))
                                    ) : (
                                        <span>// no packages — name match only</span>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleRemove(s.name)}
                                disabled={pending}
                                className="text-xs px-2 py-1"
                                style={{ color: '#ef4444' }}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p
                    className="text-xs mb-5 rounded-md border p-3"
                    style={{ borderColor: BORDER, color: TEXT_DIM }}
                >
                    No sponsors yet. Add one below.
                </p>
            )}

            {/* Mode tabs */}
            <div className="flex items-center gap-1 mb-4" role="tablist">
                {(['catalog', 'custom'] as Mode[]).map((m) => {
                    const active = m === mode;
                    return (
                        <button
                            key={m}
                            type="button"
                            onClick={() => {
                                setMode(m);
                                setError(null);
                            }}
                            className="text-xs uppercase tracking-wider px-3 py-1.5"
                            style={{
                                background: active ? 'rgba(204,120,92,0.08)' : 'transparent',
                                border: `1px solid ${active ? CLAY : BORDER}`,
                                color: active ? CLAY : TEXT_DIM,
                                fontFamily: 'inherit',
                            }}
                        >
                            {m === 'catalog' ? 'From catalog' : 'Custom'}
                        </button>
                    );
                })}
                <span className="ml-3 text-xs" style={{ color: TEXT_DIM }}>
                    {mode === 'catalog'
                        ? `${SPONSOR_CATALOG.length} known sponsors with package lists`
                        : 'Just type the sponsor name — packages are optional.'}
                </span>
            </div>

            {/* Add form */}
            <form onSubmit={handleAdd} className="space-y-3">
                {mode === 'catalog' ? (
                    <>
                        <div className="relative">
                            <label
                                className="block text-xs uppercase tracking-wider mb-1.5"
                                style={{ color: TEXT_DIM }}
                            >
                                Sponsor (search by name, package, or category)
                            </label>
                            <input
                                type="text"
                                value={catalogQuery}
                                onChange={(e) => {
                                    setCatalogQuery(e.target.value);
                                    setCatalogChoice(null);
                                    setShowSuggest(true);
                                }}
                                onFocus={() => setShowSuggest(true)}
                                onBlur={() => {
                                    // Delay blur so click on a suggestion still registers
                                    blurTimer.current = setTimeout(() => setShowSuggest(false), 150);
                                }}
                                placeholder="Resend, Stripe, OpenAI…"
                                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none"
                                style={{ borderColor: BORDER }}
                            />
                            {showSuggest && suggestions.length > 0 && (
                                <div
                                    className="absolute z-10 mt-1 w-full max-h-80 overflow-y-auto rounded-md border shadow-lg"
                                    style={{
                                        background: '#0a0a0a',
                                        borderColor: BORDER,
                                    }}
                                >
                                    {suggestions.map((s) => (
                                        <button
                                            type="button"
                                            key={s.name}
                                            onMouseDown={(e) => {
                                                // mousedown fires before blur so the click registers
                                                e.preventDefault();
                                                handleSelectSuggestion(s);
                                            }}
                                            className="w-full text-left px-3 py-2 text-sm hover:opacity-90 transition-colors"
                                            style={{
                                                background:
                                                    catalogChoice?.name === s.name
                                                        ? 'rgba(204,120,92,0.10)'
                                                        : 'transparent',
                                                borderBottom: `1px solid ${BORDER}`,
                                            }}
                                        >
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="font-medium">{s.name}</span>
                                                <span
                                                    className="text-[10px] uppercase tracking-wider"
                                                    style={{ color: TEXT_DIM }}
                                                >
                                                    {s.category}
                                                </span>
                                            </div>
                                            {s.blurb && (
                                                <div className="text-xs mt-0.5" style={{ color: TEXT_DIM }}>
                                                    {s.blurb}
                                                </div>
                                            )}
                                            <div
                                                className="text-xs mt-1 font-mono truncate"
                                                style={{ color: '#A1A1A1' }}
                                            >
                                                {s.packages.join(', ')}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {catalogChoice && (
                            <div>
                                <label
                                    className="block text-xs uppercase tracking-wider mb-1.5"
                                    style={{ color: TEXT_DIM }}
                                >
                                    Packages (edit if needed)
                                </label>
                                <input
                                    type="text"
                                    value={editPackages}
                                    onChange={(e) => setEditPackages(e.target.value)}
                                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono focus:outline-none"
                                    style={{ borderColor: BORDER }}
                                />
                                <p
                                    className="text-xs mt-1"
                                    style={{ color: TEXT_DIM }}
                                >
                                    Pre-filled from catalog. Comma-separated — adjust if
                                    your sponsor's package list is event-specific.
                                </p>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <label
                                className="block text-xs uppercase tracking-wider mb-1.5"
                                style={{ color: TEXT_DIM }}
                            >
                                Sponsor name
                            </label>
                            <input
                                type="text"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                placeholder="Resend, Convex, MyCustomSponsor…"
                                maxLength={200}
                                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none"
                                style={{ borderColor: BORDER }}
                            />
                            <p
                                className="text-xs mt-1.5 leading-relaxed"
                                style={{ color: TEXT_DIM }}
                            >
                                We&apos;ll detect usage by searching each
                                submission&apos;s imports for the sponsor name
                                (whole-word match: <code>stripe</code> hits{' '}
                                <code>@stripe/stripe-js</code>, not{' '}
                                <code>pinstripe</code>). No package list
                                required.
                            </p>
                            {blockedByShortName && (
                                <p
                                    className="text-xs mt-1.5"
                                    style={{ color: '#ef4444' }}
                                >
                                    Name is too short (under 4 chars). Add
                                    packages below or use a longer brand name.
                                </p>
                            )}
                            {!blockedByShortName && showShortNameHint && (
                                <p
                                    className="text-xs mt-1.5"
                                    style={{ color: CLAY }}
                                >
                                    Heads up: short names can match unrelated
                                    imports. If the sponsor has a known npm
                                    package, add it under Advanced below for
                                    precision.
                                </p>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowCustomAdvanced((v) => !v)}
                            className="text-xs uppercase tracking-wider"
                            style={{ color: TEXT_DIM }}
                        >
                            {showCustomAdvanced ? '▾' : '▸'} Advanced — specify packages (optional)
                        </button>

                        {showCustomAdvanced && (
                            <div>
                                <label
                                    className="block text-xs uppercase tracking-wider mb-1.5"
                                    style={{ color: TEXT_DIM }}
                                >
                                    Packages (comma-separated)
                                </label>
                                <input
                                    type="text"
                                    value={customPackages}
                                    onChange={(e) => setCustomPackages(e.target.value)}
                                    placeholder="my-package, @org/sdk"
                                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono focus:outline-none"
                                    style={{ borderColor: BORDER }}
                                />
                                <p
                                    className="text-xs mt-1"
                                    style={{ color: TEXT_DIM }}
                                >
                                    Adding packages switches matching to exact
                                    npm/pypi names — name-based matching is
                                    disabled for this sponsor.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                <div>
                    <label
                        className="block text-xs uppercase tracking-wider mb-1.5"
                        style={{ color: TEXT_DIM }}
                    >
                        Prize (optional)
                    </label>
                    <input
                        type="text"
                        value={prize}
                        onChange={(e) => setPrize(e.target.value)}
                        placeholder="$2k API credits"
                        maxLength={200}
                        className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none"
                        style={{ borderColor: BORDER, maxWidth: 360 }}
                    />
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="submit"
                        disabled={
                            pending ||
                            (mode === 'catalog'
                                ? !catalogChoice
                                : !customName.trim() ||
                                  // Block the short-name case unless the
                                  // organizer has supplied packages (which
                                  // gives matching enough signal to ignore
                                  // the name entirely).
                                  (blockedByShortName &&
                                      customPackages
                                          .split(',')
                                          .map((p) => p.trim())
                                          .filter(Boolean).length === 0))
                        }
                        className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: CLAY }}
                    >
                        {pending ? 'Saving…' : 'Add sponsor'}
                    </button>
                    {error && (
                        <p className="text-xs" style={{ color: '#ef4444' }}>
                            {error}
                        </p>
                    )}
                </div>
            </form>
        </div>
    );
}

// Find catalog reference kept for re-export convenience
export { findCatalogEntry };
