'use client';

/**
 * Judge scoring UI.
 *
 * Flow:
 *  1. On mount, read judge name from localStorage. If absent, render a
 *     name-prompt screen.
 *  2. Once a name is set, fetch this judge's previously-saved scores
 *     and merge them into per-submission state.
 *  3. Each submission card has: V4 audit score, sponsors, extras, repo
 *     link, plus a (your-score, your-notes) editor. Save button POSTs
 *     to the proxy; success updates the local "Saved at ..." indicator.
 *
 * No DevProof auth is involved — the token in the URL is the credential.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';
const BORDER = 'rgba(255,255,255,0.08)';

interface Submission {
    submission_id: string;
    submitter_user_id: string;
    github_url: string;
    team_members: string[];
    extras: Record<string, unknown>;
    matched_sponsors: Record<string, number>;
    audit_status: string;
    audit_error: string | null;
    repo_score: number | null;
    repo_tier: string | null;
    submitted_at: string | null;
}

interface Props {
    slug: string;
    token: string;
    hackathonName: string;
    submissionsCloseAt: string | null;
    submissions: Submission[];
}

interface MyScore {
    score: number | null;
    notes: string;
    savedAt: string | null;  // ISO from server after save
    dirty: boolean;          // edited locally, not yet saved
    saving: boolean;
    error: string | null;
}

function lsKey(slug: string) {
    return `devproof:judge-name:${slug}`;
}

function emptyMyScore(): MyScore {
    return {
        score: null,
        notes: '',
        savedAt: null,
        dirty: false,
        saving: false,
        error: null,
    };
}

function tierLabel(tier: string | null): string {
    if (!tier) return '—';
    return tier
        .replace('TIER_', 'T')
        .replace('_DEEP', '·DEEP')
        .replace('_LOGIC', '·LOGIC')
        .replace('_UI', '·UI');
}

export function JudgeScoringClient({
    slug,
    token,
    hackathonName,
    submissionsCloseAt,
    submissions,
}: Props) {
    const [judgeName, setJudgeName] = useState<string | null>(null);
    const [nameInput, setNameInput] = useState('');
    const [scoresLoaded, setScoresLoaded] = useState(false);
    const [scoresBySubmission, setScoresBySubmission] = useState<
        Record<string, MyScore>
    >(() =>
        Object.fromEntries(
            submissions.map((s) => [s.submission_id, emptyMyScore()]),
        ),
    );

    // 1. Hydrate judge name from localStorage on mount.
    useEffect(() => {
        try {
            const stored = localStorage.getItem(lsKey(slug));
            if (stored && stored.trim()) {
                setJudgeName(stored.trim());
            }
        } catch {
            /* ignore */
        }
    }, [slug]);

    // 2. Fetch this judge's saved scores once name is known.
    useEffect(() => {
        if (!judgeName) {
            setScoresLoaded(false);
            return;
        }
        let alive = true;
        const url = `/api/hackathons-proxy/${encodeURIComponent(slug)}/judge/${encodeURIComponent(token)}/scores?judge_name=${encodeURIComponent(judgeName)}`;
        fetch(url, { cache: 'no-store' })
            .then((r) => r.json())
            .then((data: { scores: { submission_id: string; score: number | null; notes: string; updated_at: string | null }[] }) => {
                if (!alive) return;
                setScoresBySubmission((prev) => {
                    const next = { ...prev };
                    for (const s of submissions) {
                        const existing = data.scores?.find(
                            (x) => x.submission_id === s.submission_id,
                        );
                        next[s.submission_id] = existing
                            ? {
                                  score: existing.score,
                                  notes: existing.notes || '',
                                  savedAt: existing.updated_at,
                                  dirty: false,
                                  saving: false,
                                  error: null,
                              }
                            : emptyMyScore();
                    }
                    return next;
                });
                setScoresLoaded(true);
            })
            .catch(() => {
                if (!alive) return;
                setScoresLoaded(true);
            });
        return () => {
            alive = false;
        };
    }, [judgeName, slug, token, submissions]);

    const commitName = () => {
        const cleaned = nameInput.trim().slice(0, 80);
        if (!cleaned) return;
        try {
            localStorage.setItem(lsKey(slug), cleaned);
        } catch {
            /* ignore */
        }
        setJudgeName(cleaned);
    };

    const changeName = () => {
        try {
            localStorage.removeItem(lsKey(slug));
        } catch {
            /* ignore */
        }
        setJudgeName(null);
        setNameInput('');
        setScoresLoaded(false);
    };

    const updateLocal = useCallback(
        (submissionId: string, patch: Partial<MyScore>) => {
            setScoresBySubmission((prev) => ({
                ...prev,
                [submissionId]: { ...prev[submissionId], ...patch, dirty: true },
            }));
        },
        [],
    );

    const save = useCallback(
        async (submissionId: string) => {
            if (!judgeName) return;
            const my = scoresBySubmission[submissionId];
            if (!my) return;
            setScoresBySubmission((prev) => ({
                ...prev,
                [submissionId]: { ...prev[submissionId], saving: true, error: null },
            }));
            try {
                const res = await fetch(
                    `/api/hackathons-proxy/${encodeURIComponent(slug)}/judge/${encodeURIComponent(token)}/score`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            submission_id: submissionId,
                            judge_name: judgeName,
                            score: my.score,
                            notes: my.notes,
                        }),
                    },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(
                        (body?.detail as string) || `Save failed (HTTP ${res.status})`,
                    );
                }
                const body = (await res.json()) as { updated_at: string | null };
                setScoresBySubmission((prev) => ({
                    ...prev,
                    [submissionId]: {
                        ...prev[submissionId],
                        savedAt: body.updated_at,
                        dirty: false,
                        saving: false,
                        error: null,
                    },
                }));
            } catch (e) {
                setScoresBySubmission((prev) => ({
                    ...prev,
                    [submissionId]: {
                        ...prev[submissionId],
                        saving: false,
                        error: (e as Error).message,
                    },
                }));
            }
        },
        [judgeName, scoresBySubmission, slug, token],
    );

    const totalScored = useMemo(
        () =>
            Object.values(scoresBySubmission).filter((s) => s.score !== null)
                .length,
        [scoresBySubmission],
    );

    // ── Render: name-prompt if no judge name ──────────────────────────
    if (!judgeName) {
        return (
            <NamePrompt
                hackathonName={hackathonName}
                value={nameInput}
                onChange={setNameInput}
                onSubmit={commitName}
                submissionsCount={submissions.length}
            />
        );
    }

    // ── Render: scoring view ──────────────────────────────────────────
    return (
        <main
            style={{
                minHeight: '100vh',
                background: '#0a0a0a',
                color: '#EDEDED',
                fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, sans-serif',
                padding: '32px 24px 96px',
            }}
        >
            <div style={{ maxWidth: 920, margin: '0 auto' }}>
                {/* Header */}
                <header style={{ marginBottom: 28 }}>
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            marginBottom: 8,
                        }}
                    >
                        JUDGING · {submissions.length} SUBMISSION
                        {submissions.length === 1 ? '' : 'S'}
                    </div>
                    <h1
                        style={{
                            fontSize: 26,
                            fontWeight: 600,
                            letterSpacing: '-0.02em',
                            marginBottom: 8,
                        }}
                    >
                        {hackathonName}
                    </h1>
                    <div
                        className="font-mono"
                        style={{
                            display: 'flex',
                            gap: 14,
                            alignItems: 'baseline',
                            flexWrap: 'wrap',
                            fontSize: 12,
                            color: TEXT_DIM,
                        }}
                    >
                        <span>
                            judging_as{' '}
                            <span style={{ color: '#EDEDED' }}>
                                @{judgeName}
                            </span>
                        </span>
                        <button
                            onClick={changeName}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: CLAY,
                                fontSize: 11,
                                cursor: 'pointer',
                                padding: 0,
                                textDecoration: 'underline',
                                fontFamily: 'inherit',
                            }}
                        >
                            change
                        </button>
                        <span style={{ opacity: 0.6 }}>·</span>
                        <span>
                            scored{' '}
                            <span style={{ color: '#EDEDED' }}>
                                {totalScored}/{submissions.length}
                            </span>
                        </span>
                        {submissionsCloseAt && (
                            <>
                                <span style={{ opacity: 0.6 }}>·</span>
                                <span>
                                    submissions closed{' '}
                                    {new Date(
                                        submissionsCloseAt,
                                    ).toLocaleDateString()}
                                </span>
                            </>
                        )}
                    </div>
                </header>

                {!scoresLoaded && (
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 12,
                            color: TEXT_DIM,
                            marginBottom: 16,
                        }}
                    >
                        // loading your saved scores...
                    </div>
                )}

                {submissions.length === 0 ? (
                    <EmptyState />
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {submissions.map((s) => (
                            <li
                                key={s.submission_id}
                                style={{ marginBottom: 20 }}
                            >
                                <SubmissionCard
                                    submission={s}
                                    my={scoresBySubmission[s.submission_id]}
                                    onChange={(patch) =>
                                        updateLocal(s.submission_id, patch)
                                    }
                                    onSave={() => save(s.submission_id)}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </main>
    );
}


function NamePrompt({
    hackathonName,
    value,
    onChange,
    onSubmit,
    submissionsCount,
}: {
    hackathonName: string;
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    submissionsCount: number;
}) {
    return (
        <main
            style={{
                minHeight: '100vh',
                background: '#0a0a0a',
                color: '#EDEDED',
                fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, sans-serif',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 24px',
            }}
        >
            <div style={{ maxWidth: 460, width: '100%' }}>
                <div
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        marginBottom: 10,
                    }}
                >
                    JUDGING · WELCOME
                </div>
                <h1
                    style={{
                        fontSize: 24,
                        fontWeight: 600,
                        letterSpacing: '-0.02em',
                        marginBottom: 10,
                    }}
                >
                    Score {hackathonName}
                </h1>
                <p
                    style={{
                        color: TEXT_DIM,
                        fontSize: 14,
                        lineHeight: 1.55,
                        marginBottom: 20,
                    }}
                >
                    {submissionsCount} submission
                    {submissionsCount === 1 ? '' : 's'} to review. Enter your
                    name to begin — it stays on this device and identifies your
                    scores so you can come back and edit them later.
                </p>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSubmit();
                    }}
                >
                    <label
                        htmlFor="judge-name"
                        className="font-mono"
                        style={{
                            display: 'block',
                            fontSize: 11,
                            color: TEXT_DIM,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            marginBottom: 6,
                        }}
                    >
                        your_name
                    </label>
                    <input
                        id="judge-name"
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="e.g. Elsa Bismuth"
                        maxLength={80}
                        autoFocus
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: 'rgba(255,255,255,0.02)',
                            border: `1px solid ${BORDER}`,
                            color: '#EDEDED',
                            fontSize: 14,
                            outline: 'none',
                            fontFamily: 'inherit',
                            marginBottom: 14,
                        }}
                    />
                    <button
                        type="submit"
                        disabled={!value.trim()}
                        style={{
                            background: CLAY,
                            color: '#fff',
                            border: 'none',
                            padding: '10px 22px',
                            borderRadius: 4,
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: value.trim() ? 'pointer' : 'not-allowed',
                            opacity: value.trim() ? 1 : 0.5,
                            fontFamily: 'inherit',
                        }}
                    >
                        Start judging →
                    </button>
                </form>
            </div>
        </main>
    );
}


function EmptyState() {
    return (
        <div
            className="font-mono"
            style={{
                padding: 32,
                textAlign: 'center',
                color: TEXT_DIM,
                border: `1px solid ${BORDER}`,
                fontSize: 12,
            }}
        >
            // no submissions to judge yet
        </div>
    );
}


function SubmissionCard({
    submission,
    my,
    onChange,
    onSave,
}: {
    submission: Submission;
    my: MyScore | undefined;
    onChange: (patch: Partial<MyScore>) => void;
    onSave: () => void;
}) {
    if (!my) return null;

    const repoShort = submission.github_url.replace('https://github.com/', '');
    const sponsorEntries = Object.entries(submission.matched_sponsors ?? {});
    const extrasEntries = Object.entries(submission.extras ?? {}).filter(
        ([, v]) => v !== null && v !== '',
    );

    return (
        <div
            className="font-mono"
            style={{
                padding: '20px 22px',
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${BORDER}`,
            }}
        >
            {/* Header: submitter + tier + repo */}
            <div
                style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    marginBottom: 8,
                }}
            >
                <span
                    style={{
                        fontSize: 16,
                        color: '#EDEDED',
                        fontWeight: 500,
                    }}
                >
                    @{submission.submitter_user_id}
                </span>
                {submission.team_members.length > 1 && (
                    <span
                        style={{
                            fontSize: 11,
                            color: TEXT_DIM,
                            letterSpacing: '0.04em',
                        }}
                    >
                        +{submission.team_members.length - 1} teammate
                        {submission.team_members.length - 1 === 1 ? '' : 's'}
                    </span>
                )}
                <span style={{ opacity: 0.5, fontSize: 11 }}>·</span>
                <span style={{ fontSize: 11, color: TEXT_DIM }}>
                    {tierLabel(submission.repo_tier)}
                </span>
            </div>

            <a
                href={submission.github_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                    fontSize: 12,
                    color: '#A1A1A1',
                    wordBreak: 'break-all',
                    display: 'block',
                    marginBottom: 14,
                    textDecoration: 'underline',
                }}
            >
                {repoShort} ↗
            </a>

            {/* V4 audit score */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
                <span
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                    }}
                >
                    audit_score
                </span>
                <span style={{ fontSize: 22, color: CLAY, fontWeight: 500 }}>
                    {submission.repo_score !== null
                        ? submission.repo_score
                        : '—'}
                </span>
                {submission.repo_score !== null && (
                    <span style={{ fontSize: 12, color: TEXT_DIM }}>/100</span>
                )}
            </div>

            {/* Sponsors */}
            {sponsorEntries.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                    <div
                        style={{
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            marginBottom: 6,
                        }}
                    >
                        sponsors_matched
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {sponsorEntries.map(([name, count]) => (
                            <span
                                key={name}
                                style={{
                                    fontSize: 11,
                                    padding: '4px 8px',
                                    border: `1px solid ${count > 1 ? CLAY : BORDER}`,
                                    background:
                                        count > 1
                                            ? 'rgba(204,120,92,0.06)'
                                            : 'transparent',
                                }}
                            >
                                <span style={{ color: TEXT_DIM }}>[</span>
                                {name}
                                {count > 1 && (
                                    <span style={{ color: CLAY, marginLeft: 3 }}>
                                        ×{count}
                                    </span>
                                )}
                                <span style={{ color: TEXT_DIM }}>]</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Extras */}
            {extrasEntries.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                    <div
                        style={{
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            marginBottom: 6,
                        }}
                    >
                        extras
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
                        {extrasEntries.map(([k, v]) => (
                            <li
                                key={k}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '130px 1fr',
                                    gap: 12,
                                    padding: '4px 0',
                                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                                }}
                            >
                                <span style={{ color: TEXT_DIM }}>{k}</span>
                                <span
                                    style={{
                                        color: '#EDEDED',
                                        wordBreak: 'break-word',
                                    }}
                                >
                                    {typeof v === 'string' &&
                                    /^https?:\/\//.test(v) ? (
                                        <a
                                            href={v}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                color: CLAY,
                                                textDecoration: 'underline',
                                            }}
                                        >
                                            {v}
                                        </a>
                                    ) : (
                                        String(v)
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Your score */}
            <div
                style={{
                    marginTop: 18,
                    paddingTop: 14,
                    borderTop: `1px solid ${BORDER}`,
                }}
            >
                <div
                    style={{
                        fontSize: 10,
                        color: TEXT_DIM,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        marginBottom: 8,
                    }}
                >
                    your_score
                </div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 10,
                        flexWrap: 'wrap',
                    }}
                >
                    <input
                        type="number"
                        min={0}
                        max={5}
                        step={0.5}
                        value={my.score ?? ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            const parsed = v === '' ? null : Number(v);
                            onChange({
                                score:
                                    parsed === null || isNaN(parsed)
                                        ? null
                                        : Math.max(0, Math.min(5, parsed)),
                            });
                        }}
                        placeholder="0-5"
                        style={{
                            width: 80,
                            padding: '8px 10px',
                            background: 'rgba(255,255,255,0.02)',
                            border: `1px solid ${BORDER}`,
                            color: '#EDEDED',
                            fontSize: 14,
                            outline: 'none',
                            fontFamily: 'inherit',
                        }}
                    />
                    <span style={{ fontSize: 12, color: TEXT_DIM }}>/ 5</span>
                </div>
                <textarea
                    value={my.notes}
                    onChange={(e) => onChange({ notes: e.target.value })}
                    placeholder="Notes (visible to organizer & other judges)"
                    rows={3}
                    style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: 'rgba(255,255,255,0.02)',
                        border: `1px solid ${BORDER}`,
                        color: '#EDEDED',
                        fontSize: 12,
                        outline: 'none',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        marginBottom: 10,
                    }}
                />
                <div
                    style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                >
                    <button
                        onClick={onSave}
                        disabled={!my.dirty || my.saving}
                        style={{
                            background: my.dirty ? CLAY : 'transparent',
                            border: `1px solid ${my.dirty ? CLAY : BORDER}`,
                            color: my.dirty ? '#fff' : TEXT_DIM,
                            padding: '6px 16px',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor:
                                !my.dirty || my.saving
                                    ? 'default'
                                    : 'pointer',
                            opacity: my.saving ? 0.6 : 1,
                            fontFamily: 'inherit',
                        }}
                    >
                        {my.saving
                            ? 'Saving…'
                            : my.dirty
                              ? 'Save'
                              : my.savedAt
                                ? 'Saved'
                                : 'Save'}
                    </button>
                    {my.savedAt && !my.dirty && (
                        <span style={{ fontSize: 10, color: TEXT_DIM }}>
                            // last saved{' '}
                            {new Date(my.savedAt).toLocaleTimeString()}
                        </span>
                    )}
                    {my.error && (
                        <span style={{ fontSize: 11, color: '#fca5a5' }}>
                            ✗ {my.error}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
