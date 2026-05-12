'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type {
    AdminSubmission,
    HackathonDetail,
} from '@/lib/types/hackathon';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

interface Props {
    hackathon: HackathonDetail;
    submissions: AdminSubmission[];
}

interface Category {
    id: string;
    label: string;
    /** Read-only system categories that auto-suggest from data. */
    suggestedFrom?: 'top_score' | 'sponsor';
    sponsorName?: string;
}

function defaultCategories(hackathon: HackathonDetail): Category[] {
    const base: Category[] = [
        {
            id: 'best_engineering',
            label: 'Best Engineering',
            suggestedFrom: 'top_score',
        },
        { id: 'most_creative', label: 'Most Creative' },
        { id: 'best_design', label: 'Best Design' },
        { id: 'rookie', label: 'Rookie of the Year' },
    ];
    for (const sponsor of hackathon.sponsors ?? []) {
        base.push({
            id: `sponsor_${sponsor.name.toLowerCase().replace(/\s+/g, '_')}`,
            label: `Best Use of ${sponsor.name}`,
            suggestedFrom: 'sponsor',
            sponsorName: sponsor.name,
        });
    }
    return base;
}

const STORAGE_PREFIX = 'devproof:hackathon-awards';

export function AwardsClient({ hackathon, submissions }: Props) {
    const categories = useMemo(
        () => defaultCategories(hackathon),
        [hackathon],
    );
    const [selections, setSelections] = useState<Record<string, string[]>>({});
    const [loaded, setLoaded] = useState(false);

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const raw = localStorage.getItem(`${STORAGE_PREFIX}:${hackathon.slug}`);
            if (raw) setSelections(JSON.parse(raw));
        } catch {
            /* ignore */
        }
        setLoaded(true);
    }, [hackathon.slug]);

    // Persist on change
    useEffect(() => {
        if (!loaded) return;
        try {
            localStorage.setItem(
                `${STORAGE_PREFIX}:${hackathon.slug}`,
                JSON.stringify(selections),
            );
        } catch {
            /* ignore */
        }
    }, [selections, hackathon.slug, loaded]);

    const toggle = (categoryId: string, submissionId: string) => {
        setSelections((prev) => {
            const current = new Set(prev[categoryId] ?? []);
            if (current.has(submissionId)) current.delete(submissionId);
            else current.add(submissionId);
            return { ...prev, [categoryId]: Array.from(current) };
        });
    };

    const clearAll = () => {
        setSelections({});
    };

    return (
        <main className="container mx-auto px-4 py-10 max-w-5xl">
            <header className="mb-8">
                <Link
                    href={`/hackathons/${hackathon.slug}/admin`}
                    className="font-mono text-[11px] text-muted-foreground hover:text-foreground tracking-[0.08em]"
                >
                    ← BACK_TO_DASHBOARD
                </Link>
                <div
                    className="mt-3 flex items-center justify-between flex-wrap gap-3"
                >
                    <h1
                        className="font-mono"
                        style={{
                            fontSize: 22,
                            fontWeight: 500,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                        }}
                    >
                        AWARDS · {hackathon.name}
                    </h1>
                    <Button variant="outline" size="sm" onClick={clearAll}>
                        Clear all
                    </Button>
                </div>
                <p
                    className="font-mono text-muted-foreground mt-2"
                    style={{ fontSize: 11, lineHeight: 1.6 }}
                >
                    <span style={{ color: TEXT_DIM }}>// </span>
                    Local-only assignments — saved per browser. Wire to the backend
                    once Track A exposes a write endpoint.
                </p>
            </header>

            <div className="space-y-10">
                {categories.map((cat) => {
                    const picked = new Set(selections[cat.id] ?? []);
                    let suggested: AdminSubmission | null = null;
                    if (cat.suggestedFrom === 'top_score') {
                        suggested =
                            submissions
                                .filter((s) => s.repo_score !== null)
                                .sort(
                                    (a, b) =>
                                        (b.repo_score ?? -1) - (a.repo_score ?? -1),
                                )[0] ?? null;
                    } else if (
                        cat.suggestedFrom === 'sponsor' &&
                        cat.sponsorName
                    ) {
                        suggested =
                            submissions
                                .filter(
                                    (s) =>
                                        s.matched_sponsors?.[cat.sponsorName!] !==
                                        undefined,
                                )
                                .sort(
                                    (a, b) =>
                                        (b.repo_score ?? -1) - (a.repo_score ?? -1),
                                )[0] ?? null;
                    }
                    return (
                        <section key={cat.id}>
                            <div
                                className="font-mono"
                                style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: 10,
                                    marginBottom: 12,
                                    flexWrap: 'wrap',
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: 14,
                                        color: '#EDEDED',
                                        letterSpacing: '0.04em',
                                        textTransform: 'uppercase',
                                        fontWeight: 500,
                                    }}
                                >
                                    {cat.label}
                                </span>
                                <span style={{ color: TEXT_DIM, opacity: 0.6 }}>·</span>
                                <span
                                    style={{
                                        fontSize: 11,
                                        color: TEXT_DIM,
                                        letterSpacing: '0.06em',
                                    }}
                                >
                                    {picked.size} selected
                                </span>
                                {suggested && (
                                    <>
                                        <span style={{ color: TEXT_DIM, opacity: 0.6 }}>
                                            ·
                                        </span>
                                        <span
                                            style={{
                                                fontSize: 10,
                                                color: TEXT_DIM,
                                                letterSpacing: '0.06em',
                                            }}
                                        >
                                            suggest:{' '}
                                            <span style={{ color: CLAY }}>
                                                {suggested.submitter_username}
                                            </span>
                                        </span>
                                    </>
                                )}
                            </div>

                            <div
                                style={{
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    background: 'rgba(255,255,255,0.01)',
                                }}
                            >
                                {submissions.length === 0 ? (
                                    <div
                                        className="font-mono"
                                        style={{
                                            padding: '24px',
                                            color: TEXT_DIM,
                                            fontSize: 11,
                                            letterSpacing: '0.04em',
                                        }}
                                    >
                                        // no submissions yet
                                    </div>
                                ) : (
                                    submissions.map((s) => {
                                        const checked = picked.has(s.submission_id);
                                        return (
                                            <label
                                                key={s.submission_id}
                                                className="font-mono"
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns:
                                                        '24px minmax(140px, 1.2fr) 1fr 60px',
                                                    gap: 12,
                                                    alignItems: 'center',
                                                    padding: '10px 16px',
                                                    fontSize: 12,
                                                    cursor: 'pointer',
                                                    borderBottom:
                                                        '1px solid var(--border)',
                                                    background: checked
                                                        ? 'rgba(204,120,92,0.04)'
                                                        : 'transparent',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() =>
                                                        toggle(cat.id, s.submission_id)
                                                    }
                                                    style={{
                                                        accentColor: CLAY,
                                                    }}
                                                />
                                                <span
                                                    style={{
                                                        color: '#EDEDED',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {s.submitter_username}
                                                </span>
                                                <span
                                                    style={{
                                                        color: '#A1A1A1',
                                                        fontSize: 11,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {s.github_url.replace(
                                                        'https://github.com/',
                                                        '',
                                                    )}
                                                </span>
                                                <span
                                                    style={{
                                                        color:
                                                            s.repo_score !== null
                                                                ? '#EDEDED'
                                                                : TEXT_DIM,
                                                        fontVariantNumeric:
                                                            'tabular-nums',
                                                        fontSize: 13,
                                                        textAlign: 'right',
                                                    }}
                                                >
                                                    {s.repo_score ?? '—'}
                                                </span>
                                            </label>
                                        );
                                    })
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
        </main>
    );
}
