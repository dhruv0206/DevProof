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
    // Resolved github username for display. Falls back to user_id if the
    // backend hasn't been updated to include it yet.
    submitter_username?: string | null;
    submitter_name?: string | null;
    github_url: string;
    team_members: string[];
    extras: Record<string, unknown>;
    matched_sponsors: Record<string, number>;
    audit_status: string;
    audit_error: string | null;
    repo_score: number | null;
    repo_tier: string | null;
    // Hackathon headline score: V4 minus forensics, /100. Falls back to
    // repo_score when the backend hasn't been redeployed.
    hackathon_adjusted_score?: number | null;
    submitted_at: string | null;
    // New first-class fields, populated when the backend has been updated.
    // Optional so older payloads still typecheck.
    tagline?: string | null;
    team_name?: string | null;
    demo_url?: string | null;
    what_it_does?: string | null;
}

// Shape returned by /judge/{token}/submissions/{id}/details — same shape
// as the organizer-side full view. Kept narrow to what the judge UI
// actually renders.
interface JudgeSubmissionDetails {
    submission: {
        submission_id: string;
        github_url: string;
        tagline: string | null;
        what_it_does: string | null;
        demo_url: string | null;
        team_name: string | null;
        team_members: string[];
        extras: Record<string, unknown>;
    };
    submitter?: {
        user_id: string;
        username: string | null;
        name: string | null;
    };
    audit: {
        v4_score: number | null;
        v4_tier: string | null;
        v4_output: Record<string, unknown> | null;
    };
    show_sponsor_evidence: boolean;
    sponsor_evidence: Record<string, unknown[]> | null;
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
                                    slug={slug}
                                    token={token}
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
                        placeholder="e.g. Jane Doe"
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
    slug,
    token,
}: {
    submission: Submission;
    my: MyScore | undefined;
    onChange: (patch: Partial<MyScore>) => void;
    onSave: () => void;
    slug: string;
    token: string;
}) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [details, setDetails] = useState<JudgeSubmissionDetails | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);

    const toggleDetails = async () => {
        if (detailsOpen) {
            setDetailsOpen(false);
            return;
        }
        setDetailsOpen(true);
        if (details || detailsLoading) return;
        setDetailsLoading(true);
        setDetailsError(null);
        try {
            const res = await fetch(
                `/api/hackathons-proxy/${encodeURIComponent(slug)}/judge/${encodeURIComponent(token)}/submissions/${encodeURIComponent(submission.submission_id)}/details`,
                { cache: 'no-store' },
            );
            if (!res.ok) {
                setDetailsError(`Could not load details (HTTP ${res.status}).`);
                return;
            }
            const body = (await res.json()) as JudgeSubmissionDetails;
            setDetails(body);
        } catch {
            setDetailsError('Network error loading details.');
        } finally {
            setDetailsLoading(false);
        }
    };

    if (!my) return null;

    const repoShort = submission.github_url.replace('https://github.com/', '');
    const sponsorEntries = Object.entries(submission.matched_sponsors ?? {});
    const extrasEntries = Object.entries(submission.extras ?? {}).filter(
        ([, v]) => v !== null && v !== '',
    );
    const videoUrl =
        typeof submission.extras?.demo_video_url === 'string'
            ? (submission.extras.demo_video_url as string)
            : null;
    const demoUrl =
        submission.demo_url ??
        (typeof submission.extras?.deployed_url === 'string'
            ? (submission.extras.deployed_url as string)
            : null);

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
                    @{submission.submitter_username ?? submission.submitter_user_id}
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
                {(() => {
                    // Flag legacy submissions that lack the post-2026-05-19
                    // quality fields. New submissions are gated server-side
                    // and will never trigger this; the chip is here so
                    // judges can deprioritize old incomplete entries.
                    // Required floor: what_it_does + video URL (demo URL is
                    // optional — not everyone can deploy).
                    const hasVideo =
                        typeof submission.extras?.demo_video_url === 'string' &&
                        (submission.extras.demo_video_url as string).trim();
                    const incomplete =
                        !submission.what_it_does || !hasVideo;
                    if (!incomplete) return null;
                    return (
                        <>
                            <span style={{ opacity: 0.5, fontSize: 11 }}>·</span>
                            <span
                                style={{
                                    fontSize: 10,
                                    color: '#F59E0B',
                                    letterSpacing: '0.08em',
                                    border: '1px solid rgba(245,158,11,0.3)',
                                    padding: '1px 6px',
                                    background: 'rgba(245,158,11,0.06)',
                                }}
                            >
                                // INCOMPLETE
                            </span>
                        </>
                    );
                })()}
            </div>

            {/* Tagline + team name (new first-class fields, 2026-05-17). Always
             * shown when present — they're 1-liners and help the judge get
             * context without expanding. */}
            {submission.team_name && (
                <div
                    style={{
                        fontSize: 11,
                        color: CLAY,
                        letterSpacing: '0.04em',
                        marginBottom: 4,
                    }}
                >
                    {submission.team_name}
                </div>
            )}
            {submission.tagline && (
                <p
                    style={{
                        fontSize: 13,
                        color: '#EDEDED',
                        lineHeight: 1.5,
                        marginBottom: 10,
                        fontFamily:
                            'ui-sans-serif, system-ui, -apple-system, sans-serif',
                    }}
                >
                    {submission.tagline}
                </p>
            )}

            <a
                href={submission.github_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                    fontSize: 12,
                    color: '#A1A1A1',
                    wordBreak: 'break-all',
                    display: 'block',
                    marginBottom: (videoUrl || demoUrl) ? 6 : 14,
                    textDecoration: 'underline',
                }}
            >
                {repoShort} ↗
            </a>

            {/* Demo + video links — shown inline below the repo so judges
             * can click straight through without expanding. */}
            {(videoUrl || demoUrl) && (
                <div
                    style={{
                        display: 'flex',
                        gap: 14,
                        marginBottom: 14,
                        fontSize: 12,
                    }}
                >
                    {demoUrl && (
                        <a
                            href={demoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: CLAY, textDecoration: 'underline' }}
                        >
                            Live demo ↗
                        </a>
                    )}
                    {videoUrl && (
                        <a
                            href={videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: CLAY, textDecoration: 'underline' }}
                        >
                            Video ↗
                        </a>
                    )}
                </div>
            )}

            {/* Hackathon-adjusted audit score. Headline is the 3-bucket
             * /100 score that excludes forensics — hackathon submissions
             * are typically a single push, so penalizing them on commit
             * history is the wrong rubric. Falls back to repo_score when
             * the backend payload doesn't carry the adjusted field yet. */}
            {(() => {
                const headline =
                    typeof submission.hackathon_adjusted_score === 'number'
                        ? submission.hackathon_adjusted_score
                        : submission.repo_score;
                return (
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
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
                                {headline !== null && headline !== undefined ? headline : '—'}
                            </span>
                            {headline !== null && headline !== undefined && (
                                <span style={{ fontSize: 12, color: TEXT_DIM }}>/100</span>
                            )}
                        </div>
                        <div
                            style={{
                                fontSize: 10,
                                color: TEXT_DIM,
                                letterSpacing: '0.04em',
                                fontFamily: 'ui-monospace, monospace',
                                marginTop: 4,
                            }}
                        >
                            // hackathon-adjusted · commits not weighted
                        </div>
                    </div>
                );
            })()}

            {/* View details — lazy-loaded audit detail (claims, architecture,
             * skills, score breakdown). Hidden behind a toggle because most
             * judges only need to dig in occasionally; the always-visible
             * fields above cover the common case. */}
            <div style={{ marginBottom: 14 }}>
                <button
                    type="button"
                    onClick={toggleDetails}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: CLAY,
                        fontSize: 11,
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                        padding: 0,
                        fontFamily: 'inherit',
                    }}
                >
                    {detailsOpen ? '▾ Hide audit details' : '▸ View audit details'}
                </button>
                {detailsOpen && (
                    <DetailsPanel
                        details={details}
                        loading={detailsLoading}
                        error={detailsError}
                        whatItDoes={submission.what_it_does ?? null}
                    />
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


/**
 * DetailsPanel — rendered inline when a judge expands a submission card.
 * Surfaces:
 *   • "ABOUT" paragraph (what_it_does)
 *   • Verified claims with file:line evidence
 *   • Architecture patterns
 *   • Skills demonstrated
 *   • Score breakdown (sub-scores)
 *
 * All read from the v4_output blob that the details endpoint returns.
 * Loading/error states render in-place so the card doesn't jump around.
 */
function DetailsPanel({
    details,
    loading,
    error,
    whatItDoes,
}: {
    details: JudgeSubmissionDetails | null;
    loading: boolean;
    error: string | null;
    whatItDoes: string | null;
}) {
    if (loading) {
        return (
            <div
                style={{
                    marginTop: 10,
                    padding: '12px 14px',
                    border: `1px dashed ${BORDER}`,
                    fontSize: 11,
                    color: TEXT_DIM,
                }}
            >
                ⋯ loading audit details…
            </div>
        );
    }
    if (error) {
        return (
            <div
                style={{
                    marginTop: 10,
                    padding: '12px 14px',
                    border: '1px solid rgba(239,68,68,0.35)',
                    background: 'rgba(239,68,68,0.06)',
                    fontSize: 11,
                    color: '#fca5a5',
                }}
            >
                {error}
            </div>
        );
    }
    if (!details) return null;

    // The V4 output blob shape is broad and partially typed elsewhere; here
    // we narrow at the field-read level so a missing/renamed field just
    // results in the section not rendering.
    const v4 = (details.audit?.v4_output ?? {}) as Record<string, unknown>;
    const claims =
        (v4.features as Record<string, unknown>[] | undefined) ??
        (v4.verified_features as Record<string, unknown>[] | undefined) ??
        [];
    const architecture =
        (v4.architecture as Record<string, unknown>[] | undefined) ??
        (v4.architecture_patterns as Record<string, unknown>[] | undefined) ??
        [];
    const skills =
        (v4.skills as Array<string | { name?: string }> | undefined) ?? [];
    // V4 emits score_breakdown as { bucket: { score: number, max: number } }
    // rather than a flat { bucket: number }. Normalize so the renderer below
    // can display "score/max" in both shapes (and gracefully degrade if a
    // future variant changes the keys again).
    const rawBreakdown =
        (v4.score_breakdown as Record<string, unknown> | undefined) ?? null;
    const breakdown: Record<string, { score: number; max: number | null }> | null =
        rawBreakdown
            ? Object.fromEntries(
                  Object.entries(rawBreakdown).map(([k, v]) => {
                      if (typeof v === 'number') {
                          return [k, { score: v, max: null }];
                      }
                      const obj = (v ?? {}) as Record<string, unknown>;
                      const score = typeof obj.score === 'number' ? obj.score : 0;
                      const max = typeof obj.max === 'number' ? obj.max : null;
                      return [k, { score, max }];
                  }),
              )
            : null;

    return (
        <div
            style={{
                marginTop: 12,
                padding: '14px 16px',
                border: `1px solid ${BORDER}`,
                background: 'rgba(255,255,255,0.015)',
            }}
        >
            {/* ABOUT */}
            {whatItDoes && (
                <DetailSection label="ABOUT">
                    <p
                        style={{
                            fontSize: 12.5,
                            color: '#A1A1A1',
                            lineHeight: 1.55,
                            whiteSpace: 'pre-wrap',
                            margin: 0,
                            fontFamily:
                                'ui-sans-serif, system-ui, -apple-system, sans-serif',
                        }}
                    >
                        {whatItDoes}
                    </p>
                </DetailSection>
            )}

            {/* PROJECT OVERVIEW — always present, even when other sections
             * are sparse. Surfaces what V4 actually looked at so judges
             * understand the score in context. */}
            <ProjectOverviewSection
                v4={v4}
                claimCount={claims.length}
                architectureCount={architecture.length}
                skillsCount={skills.length}
            />

            {/* SCORE BREAKDOWN */}
            {breakdown && Object.keys(breakdown).length > 0 && (
                <DetailSection label="SCORE_BREAKDOWN">
                    <div
                        style={{
                            fontSize: 10,
                            color: TEXT_DIM,
                            letterSpacing: '0.04em',
                            fontFamily: 'ui-monospace, monospace',
                            marginBottom: 8,
                        }}
                    >
                        // hackathon-adjusted · commits not weighted
                    </div>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: 8,
                            fontSize: 12,
                        }}
                    >
                        {Object.entries(breakdown).map(([k, v]) => {
                            const isForensics = k === 'forensics';
                            const pct = v.max && v.max > 0
                                ? (v.score / v.max) * 100
                                : null;
                            const description = BUCKET_DESCRIPTIONS[k] || null;
                            return (
                                <div
                                    key={k}
                                    style={{
                                        padding: '8px 10px',
                                        border: `1px solid ${BORDER}`,
                                        background: isForensics
                                            ? 'rgba(255,255,255,0.01)'
                                            : 'rgba(255,255,255,0.02)',
                                        opacity: isForensics ? 0.55 : 1,
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: 9,
                                            color: TEXT_DIM,
                                            letterSpacing: '0.06em',
                                            textTransform: 'uppercase',
                                        }}
                                    >
                                        {k.replace(/_/g, ' ')}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 14,
                                            color: isForensics
                                                ? TEXT_DIM
                                                : pct !== null && pct >= 70
                                                    ? CLAY
                                                    : '#EDEDED',
                                            fontVariantNumeric: 'tabular-nums',
                                        }}
                                    >
                                        {v.score.toFixed(0)}
                                        {v.max !== null && (
                                            <span style={{ color: TEXT_DIM, fontSize: 11 }}>
                                                {' '}/ {v.max}
                                            </span>
                                        )}
                                    </div>
                                    {description && (
                                        <div
                                            style={{
                                                fontSize: 10,
                                                color: TEXT_DIM,
                                                lineHeight: 1.4,
                                                marginTop: 4,
                                                fontFamily:
                                                    'ui-sans-serif, system-ui, -apple-system, sans-serif',
                                            }}
                                        >
                                            {description}
                                        </div>
                                    )}
                                    {isForensics && (
                                        <div
                                            style={{
                                                fontSize: 9,
                                                color: TEXT_DIM,
                                                marginTop: 4,
                                                fontFamily: 'ui-monospace, monospace',
                                                letterSpacing: '0.04em',
                                            }}
                                        >
                                            // not weighted
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </DetailSection>
            )}

            {/* VERIFIED CLAIMS — always shown so judges know what the algo
             * looked for, with empty-state copy when V4 found none. */}
            <DetailSection
                label={`VERIFIED_CLAIMS · ${claims.length}`}
            >
                {claims.length === 0 ? (
                    <EmptyStateNote>
                        V4 generates verifiable claims for cross-file logic,
                        services, and complex flows. Tutorial / boilerplate /
                        scaffold repos legitimately produce 0 here.
                    </EmptyStateNote>
                ) : (
                    <>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {claims.slice(0, 12).map((c, i) => {
                                const summary =
                                    (c.summary as string | undefined) ??
                                    (c.title as string | undefined) ??
                                    '(no summary)';
                                const tier = c.tier as string | undefined;
                                const files = (c.evidence_files as string[] | undefined) ?? [];
                                const lines = (c.evidence_lines as number[] | undefined) ?? [];
                                return (
                                    <li
                                        key={i}
                                        style={{
                                            padding: '6px 0',
                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                        }}
                                    >
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                            {tier && (
                                                <span
                                                    style={{
                                                        fontSize: 9,
                                                        color: CLAY,
                                                        letterSpacing: '0.06em',
                                                    }}
                                                >
                                                    {tier.replace('TIER_', 'T')}
                                                </span>
                                            )}
                                            <span style={{ fontSize: 12, color: '#EDEDED' }}>
                                                {summary}
                                            </span>
                                        </div>
                                        {files.length > 0 && (
                                            <div
                                                style={{
                                                    fontSize: 10,
                                                    color: TEXT_DIM,
                                                    fontFamily: 'ui-monospace, monospace',
                                                    marginTop: 2,
                                                    wordBreak: 'break-all',
                                                }}
                                            >
                                                {files.slice(0, 3).map((f, idx) => (
                                                    <span key={idx}>
                                                        {f}
                                                        {lines[idx] !== undefined ? `:${lines[idx]}` : ''}
                                                        {idx < Math.min(files.length, 3) - 1 ? ' · ' : ''}
                                                    </span>
                                                ))}
                                                {files.length > 3 && (
                                                    <span> +{files.length - 3} more</span>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                        {claims.length > 12 && (
                            <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 6 }}>
                                // {claims.length - 12} more claims not shown
                            </div>
                        )}
                    </>
                )}
            </DetailSection>

            {/* ARCHITECTURE — always shown with empty-state copy when sparse. */}
            <DetailSection label={`ARCHITECTURE · ${architecture.length}`}>
                {architecture.length === 0 ? (
                    <EmptyStateNote>
                        V4 detects cross-file architectural patterns (service
                        layers, streaming pipelines, agent loops, etc.).
                        Single-file or thin-wrapper projects often score 0
                        here even with working features.
                    </EmptyStateNote>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
                        {architecture.slice(0, 8).map((p, i) => (
                            <li
                                key={i}
                                style={{
                                    padding: '3px 0',
                                    color: '#A1A1A1',
                                }}
                            >
                                <span style={{ color: CLAY }}>›</span>{' '}
                                {(p.pattern as string | undefined) ??
                                    (p.name as string | undefined) ??
                                    '(unnamed pattern)'}
                            </li>
                        ))}
                    </ul>
                )}
            </DetailSection>

            {/* SKILLS — always shown with empty-state copy when sparse. */}
            <DetailSection label={`SKILLS · ${skills.length}`}>
                {skills.length === 0 ? (
                    <EmptyStateNote>
                        Skills are derived from verified claims + architecture
                        patterns. With 0 claims and 0 patterns above, the
                        skills list is correctly empty.
                    </EmptyStateNote>
                ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {skills.slice(0, 30).map((sk, i) => {
                            const name =
                                typeof sk === 'string'
                                    ? sk
                                    : (sk?.name as string | undefined) ?? '';
                            if (!name) return null;
                            return (
                                <span
                                    key={i}
                                    style={{
                                        fontSize: 11,
                                        padding: '3px 8px',
                                        border: `1px solid ${BORDER}`,
                                        color: '#EDEDED',
                                    }}
                                >
                                    {name}
                                </span>
                            );
                        })}
                    </div>
                )}
            </DetailSection>

            {/* SPONSOR EVIDENCE (gated on organizer toggle) */}
            {details.show_sponsor_evidence &&
                details.sponsor_evidence &&
                Object.keys(details.sponsor_evidence).length > 0 && (
                    <DetailSection label="SPONSOR_EVIDENCE">
                        {Object.entries(details.sponsor_evidence).map(([sponsor, entries]) => (
                            <div key={sponsor} style={{ marginBottom: 8 }}>
                                <div
                                    style={{
                                        fontSize: 11,
                                        color: CLAY,
                                        letterSpacing: '0.04em',
                                        marginBottom: 3,
                                    }}
                                >
                                    {sponsor}
                                    <span style={{ color: TEXT_DIM }}>
                                        {' '}
                                        · {(entries as unknown[]).length} matches
                                    </span>
                                </div>
                            </div>
                        ))}
                    </DetailSection>
                )}

            {claims.length === 0 &&
                architecture.length === 0 &&
                skills.length === 0 &&
                !breakdown && (
                    <div style={{ fontSize: 11, color: TEXT_DIM }}>
                        // audit blob is empty — submission may still be running
                    </div>
                )}
        </div>
    );
}

function DetailSection({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{ marginBottom: 14 }}>
            <div
                style={{
                    fontSize: 9,
                    color: TEXT_DIM,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                }}
            >
                {label}
            </div>
            {children}
        </div>
    );
}

/** One-line "what this bucket measures" copy. Shown under each
 *  SCORE_BREAKDOWN tile so judges know what the number means. Stays
 *  in sync with the V4 rubric — keys must match score_breakdown keys. */
const BUCKET_DESCRIPTIONS: Record<string, string> = {
    features: 'Tiered claims weighted by complexity',
    forensics: 'Commit history + provenance signals',
    architecture: 'Cross-file patterns detected',
    intent_and_standards: 'Naming, docs, conventions',
};

/** Render a small italic note for sections that V4 didn't produce
 *  output for. Replaces the previous behavior of hiding empty
 *  sections, which made the audit look broken. */
function EmptyStateNote({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                fontSize: 11,
                color: TEXT_DIM,
                lineHeight: 1.5,
                fontFamily: 'ui-monospace, monospace',
                padding: '8px 10px',
                border: `1px dashed ${BORDER}`,
                background: 'rgba(255,255,255,0.01)',
            }}
        >
            // {children}
        </div>
    );
}

/** Project Overview — always-on block at the top of the audit detail
 *  panel. Surfaces what V4 actually looked at (tech stack, complexity
 *  tier, signal counts) so judges have context even when individual
 *  sections like CLAIMS or ARCHITECTURE are empty. */
function ProjectOverviewSection({
    v4,
    claimCount,
    architectureCount,
    skillsCount,
}: {
    v4: Record<string, unknown>;
    claimCount: number;
    architectureCount: number;
    skillsCount: number;
}) {
    const stackRaw = v4.stack;
    const stack: string[] = Array.isArray(stackRaw)
        ? stackRaw
              .map((s) => (typeof s === 'string' ? s : ''))
              .filter(Boolean)
        : [];
    const tier =
        typeof v4.repo_tier === 'string'
            ? v4.repo_tier.replace('TIER_', 'T').replace('_DEEP', '·DEEP').replace('_LOGIC', '·LOGIC').replace('_UI', '·UI')
            : null;
    return (
        <DetailSection label="PROJECT_OVERVIEW">
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    columnGap: 14,
                    rowGap: 4,
                    fontSize: 12,
                    fontFamily: 'ui-monospace, monospace',
                }}
            >
                <span style={{ color: TEXT_DIM, letterSpacing: '0.04em' }}>STACK</span>
                <span style={{ color: '#EDEDED' }}>
                    {stack.length > 0 ? stack.join(' · ') : '—'}
                </span>
                <span style={{ color: TEXT_DIM, letterSpacing: '0.04em' }}>COMPLEXITY</span>
                <span style={{ color: '#EDEDED' }}>
                    {tier ?? '—'}
                </span>
                <span style={{ color: TEXT_DIM, letterSpacing: '0.04em' }}>SIGNALS</span>
                <span style={{ color: '#A1A1A1' }}>
                    {claimCount} claims · {architectureCount} patterns ·{' '}
                    {skillsCount} skills
                </span>
            </div>
        </DetailSection>
    );
}
