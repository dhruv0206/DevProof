'use client';

/**
 * Client form for /hackathons/[slug]/submit.
 *
 * Sectioned layout (single page, no wizard):
 *   1. PROJECT   — github_url (required), tagline (required), what_it_does
 *   2. DEMO      — video URL, deployed URL (optional)
 *   3. TEAM      — team_name + invite-based teammates (optional)
 *   4. EXTRAS    — organizer-configured custom fields
 *
 * Tracks opt-out lives on the post-submit dashboard (`/me`), not here —
 * the dev hasn't been audited yet, so we don't know which sponsors apply.
 *
 * Persists via the existing /api/hackathons-proxy submissions endpoint.
 * Submitter is auto-included; team management UI for adding teammates by
 * username/email is mounted in {@link TeamInviteManager} but only when the
 * dev is editing an existing submission (we need a submission_id first).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

const EXTRA_FIELD_LABELS: Record<string, { label: string; placeholder: string; type: 'url' | 'text' | 'tags' }> = {
    slide_deck_url: { label: 'SLIDE_DECK_URL', placeholder: 'https://...', type: 'url' },
    problem_statement: { label: 'PROBLEM_STATEMENT', placeholder: 'What problem this solves', type: 'text' },
    tech_stack_tags: { label: 'TECH_STACK', placeholder: 'react, postgres, ...', type: 'tags' },
};

function fieldConfig(key: string) {
    return (
        EXTRA_FIELD_LABELS[key] ?? {
            label: key.toUpperCase(),
            placeholder: '',
            type: 'text' as const,
        }
    );
}

export interface SubmitFormInitialValues {
    githubUrl?: string;
    tagline?: string;
    whatItDoes?: string;
    videoUrl?: string;
    demoUrl?: string;
    teamName?: string;
    teamMembers?: string[];
    extras?: Record<string, unknown>;
}

interface Props {
    slug: string;
    extrasRequired: string[];
    extrasOptional: string[];
    maxTeamSize: number | null;
    userId: string;
    /** When set, the form switches to edit mode: PATCH instead of POST,
     * submit button reads "Save changes", and the form starts pre-filled. */
    submissionId?: string;
    /** Pre-filled values for edit mode. Ignored when submissionId is unset. */
    initialValues?: SubmitFormInitialValues;
    /** Submissions window closed (scheduled close OR manual lock). When true,
     * the submit button is disabled and the form acts as a read-only view. */
    locked?: boolean;
}

export function SubmitForm({
    slug,
    extrasRequired,
    extrasOptional,
    maxTeamSize,
    submissionId,
    initialValues,
    locked = false,
}: Props) {
    const isEditMode = !!submissionId;
    const iv = initialValues ?? {};
    const ivExtras = iv.extras ?? {};

    // Pull video/demo back out of legacy extras into the first-class state on
    // edit — the original form merged them into extras at submit time, so the
    // stored submission has them in extras_json[demo_video_url/deployed_url].
    const extrasAsStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(ivExtras)) {
        if (typeof v === 'string') extrasAsStrings[k] = v;
        else if (Array.isArray(v)) extrasAsStrings[k] = v.join(', ');
    }
    const initialVideo = iv.videoUrl ?? extrasAsStrings.demo_video_url ?? '';
    const initialDemo = iv.demoUrl ?? extrasAsStrings.deployed_url ?? '';

    const [githubUrl, setGithubUrl] = useState(iv.githubUrl ?? '');
    const [tagline, setTagline] = useState(iv.tagline ?? '');
    const [whatItDoes, setWhatItDoes] = useState(iv.whatItDoes ?? '');
    const [videoUrl, setVideoUrl] = useState(initialVideo);
    const [demoUrl, setDemoUrl] = useState(initialDemo);
    const [teamName, setTeamName] = useState(iv.teamName ?? '');
    const [teamMembers, setTeamMembers] = useState<string[]>(iv.teamMembers ?? []);
    const [teamInput, setTeamInput] = useState('');
    const [extras, setExtras] = useState<Record<string, string>>(extrasAsStrings);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const setExtra = (key: string, value: string) =>
        setExtras((prev) => ({ ...prev, [key]: value }));

    const commitTeamChip = () => {
        const candidate = teamInput.trim().replace(/^@/, '').replace(/,$/, '');
        if (!candidate) return;
        if (teamMembers.includes(candidate)) {
            setTeamInput('');
            return;
        }
        if (maxTeamSize && teamMembers.length + 1 >= maxTeamSize) {
            setError(`Team is capped at ${maxTeamSize} (submitter included).`);
            setTeamInput('');
            return;
        }
        setTeamMembers([...teamMembers, candidate]);
        setTeamInput('');
    };

    const removeTeamChip = (name: string) =>
        setTeamMembers(teamMembers.filter((n) => n !== name));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        if (locked) {
            setError('Submissions are locked — changes can’t be saved right now.');
            return;
        }
        setError(null);

        const trimmedGh = githubUrl.trim();
        if (!trimmedGh) {
            setError('GitHub URL is required.');
            return;
        }
        if (!tagline.trim()) {
            setError('Tagline is required — one line that explains what you built.');
            return;
        }
        for (const key of extrasRequired) {
            if (!extras[key]?.trim()) {
                setError(`${fieldConfig(key).label} is required.`);
                return;
            }
        }

        setSubmitting(true);
        try {
            // Combine the new first-class fields with the legacy extras bag.
            // video_url + deployed_url go into BOTH extras (for backwards
            // compat with existing extras-based renderers) and the new
            // demo_url column. Tagline + what_it_does are first-class only.
            const builtExtras: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(extras)) {
                const cfg = fieldConfig(k);
                if (cfg.type === 'tags') {
                    builtExtras[k] = v
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean);
                } else if (v.trim()) {
                    builtExtras[k] = v.trim();
                }
            }
            if (videoUrl.trim()) builtExtras.demo_video_url = videoUrl.trim();
            if (demoUrl.trim()) builtExtras.deployed_url = demoUrl.trim();

            // Edit mode → PATCH; create mode → POST. Same shape in both:
            // server endpoints are forgiving of unknown extras keys.
            const url = isEditMode
                ? `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId!)}`
                : `/api/hackathons-proxy/${encodeURIComponent(slug)}/submissions`;
            const res = await fetch(url, {
                method: isEditMode ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    github_url: trimmedGh,
                    extras: builtExtras,
                    team_members: teamMembers,
                    tagline: tagline.trim(),
                    what_it_does: whatItDoes.trim() || null,
                    demo_url: demoUrl.trim() || null,
                    team_name: teamName.trim() || null,
                    ...(isEditMode ? {} : { tracks_opted_out: [] }),
                }),
            });

            if (res.ok || res.status === 409) {
                router.push(`/hackathons/${slug}/me`);
                return;
            }

            const body = await res.json().catch(() => null);
            const detail =
                typeof body?.detail === 'string'
                    ? body.detail
                    : typeof body?.detail?.message === 'string'
                        ? body.detail.message
                        : `Submission failed (status ${res.status}).`;
            setError(detail);
            setSubmitting(false);
        } catch {
            setError('Network error — could not reach the DevProof API.');
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-9">
            {/* ─── PROJECT section ─── */}
            <Section title="PROJECT" required>
                <Field label="GITHUB_URL" required>
                    <Input
                        type="url"
                        placeholder="https://github.com/team/project"
                        value={githubUrl}
                        onChange={(e) => setGithubUrl(e.target.value)}
                        disabled={submitting}
                        autoFocus
                        required
                        className="font-mono"
                    />
                </Field>
                <Field label="TAGLINE" required hint={`${tagline.length}/140 — one line for the leaderboard`}>
                    <Input
                        type="text"
                        placeholder="Realtime collaborative whiteboard powered by Yjs + Convex"
                        value={tagline}
                        onChange={(e) => setTagline(e.target.value.slice(0, 140))}
                        disabled={submitting}
                        maxLength={140}
                        required
                        className="font-mono"
                    />
                </Field>
                <Field label="WHAT_IT_DOES" hint={`${whatItDoes.length}/500 — context for judges`}>
                    <textarea
                        placeholder="A paragraph on the problem, what you built, and any clever bits"
                        value={whatItDoes}
                        onChange={(e) => setWhatItDoes(e.target.value.slice(0, 500))}
                        disabled={submitting}
                        maxLength={500}
                        rows={4}
                        className="border-input dark:bg-input/30 placeholder:text-muted-foreground w-full rounded-md border bg-transparent px-3 py-2 font-sans text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
                    />
                </Field>
            </Section>

            {/* ─── DEMO section ─── */}
            <Section title="DEMO">
                <Field label="VIDEO_URL">
                    <Input
                        type="url"
                        placeholder="https://youtu.be/..."
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        disabled={submitting}
                        className="font-mono"
                    />
                </Field>
                <Field label="LIVE_DEMO_URL" hint="Deployed app — judges click this">
                    <Input
                        type="url"
                        placeholder="https://your-app.vercel.app"
                        value={demoUrl}
                        onChange={(e) => setDemoUrl(e.target.value)}
                        disabled={submitting}
                        className="font-mono"
                    />
                </Field>
            </Section>

            {/* ─── TEAM section ─── */}
            <Section title="TEAM" hint="Optional. Submitting solo? Leave blank.">
                <Field
                    label="TEAM_NAME"
                    hint={`${teamName.length}/80 — leave blank for solo submissions`}
                >
                    <Input
                        type="text"
                        placeholder="Team Whisper"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value.slice(0, 80))}
                        disabled={submitting}
                        maxLength={80}
                        className="font-mono"
                    />
                </Field>
                <Field
                    label="CREDITS"
                    hint="GitHub usernames of people who helped. Structured team invites (with edit rights + dashboard visibility) become available after submitting."
                >
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                            padding: teamMembers.length > 0 ? '8px' : 0,
                            border: teamMembers.length > 0 ? '1px solid rgba(255,255,255,0.08)' : undefined,
                        }}
                    >
                        {teamMembers.map((name) => (
                            <span
                                key={name}
                                className="font-mono"
                                style={{
                                    fontSize: 11,
                                    color: '#EDEDED',
                                    letterSpacing: '0.04em',
                                    padding: '4px 6px 4px 8px',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    background: 'rgba(255,255,255,0.03)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}
                            >
                                <span style={{ color: TEXT_DIM }}>@</span>
                                <span>{name}</span>
                                <button
                                    type="button"
                                    onClick={() => removeTeamChip(name)}
                                    disabled={submitting}
                                    className="hover:text-foreground"
                                    style={{
                                        color: TEXT_DIM,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        padding: 0,
                                    }}
                                    aria-label={`Remove ${name}`}
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                    <Input
                        type="text"
                        placeholder="alex-chen, rae-kim"
                        value={teamInput}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (v.endsWith(',')) {
                                setTeamInput(v);
                                commitTeamChip();
                            } else {
                                setTeamInput(v);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitTeamChip();
                            } else if (e.key === 'Backspace' && !teamInput && teamMembers.length > 0) {
                                removeTeamChip(teamMembers[teamMembers.length - 1]);
                            }
                        }}
                        disabled={submitting}
                        className="font-mono"
                    />
                </Field>
            </Section>

            {/* ─── EXTRAS section (organizer-configured) ─── */}
            {(extrasRequired.length > 0 || extrasOptional.length > 0) && (
                <Section title="EXTRAS">
                    {extrasRequired.map((key) => (
                        <ExtraField
                            key={key}
                            keyName={key}
                            value={extras[key] ?? ''}
                            onChange={(v) => setExtra(key, v)}
                            required
                            disabled={submitting}
                        />
                    ))}
                    {extrasOptional.map((key) => (
                        <ExtraField
                            key={key}
                            keyName={key}
                            value={extras[key] ?? ''}
                            onChange={(v) => setExtra(key, v)}
                            required={false}
                            disabled={submitting}
                        />
                    ))}
                </Section>
            )}

            {error && (
                <div
                    className="font-mono"
                    style={{
                        padding: '12px 14px',
                        border: '1px solid rgba(239,68,68,0.35)',
                        background: 'rgba(239,68,68,0.06)',
                        fontSize: 12,
                        color: '#FCA5A5',
                        lineHeight: 1.5,
                    }}
                >
                    <div
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            marginBottom: 4,
                        }}
                    >
                        ERROR · SUBMISSION
                    </div>
                    <div>{error}</div>
                </div>
            )}

            <Button
                type="submit"
                className="w-full gap-2"
                size="lg"
                disabled={submitting || locked}
            >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {locked
                    ? 'Submissions are locked'
                    : submitting
                        ? (isEditMode ? 'Saving…' : 'Submitting…')
                        : (isEditMode ? 'Save changes →' : 'Submit project →')}
            </Button>
        </form>
    );
}

function Section({
    title,
    required,
    hint,
    children,
}: {
    title: string;
    required?: boolean;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-5">
            <div
                className="font-mono"
                style={{
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    color: TEXT_DIM,
                    textTransform: 'uppercase',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    flexWrap: 'wrap',
                }}
            >
                <span style={{ color: '#A1A1A1' }}>▌</span>
                <span style={{ color: '#EDEDED' }}>{title}</span>
                {required && (
                    <span style={{ color: CLAY }}>· REQUIRED</span>
                )}
                {hint && (
                    <>
                        <span style={{ opacity: 0.6 }}>·</span>
                        <span style={{ color: TEXT_DIM, textTransform: 'none', letterSpacing: 'normal' }}>
                            {hint}
                        </span>
                    </>
                )}
            </div>
            <div className="h-px bg-border" />
            <div className="space-y-5">{children}</div>
        </div>
    );
}

function Field({
    label,
    required,
    hint,
    children,
}: {
    label: string;
    required?: boolean;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-2">
            <label
                className="font-mono"
                style={{
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: TEXT_DIM,
                    display: 'block',
                }}
            >
                {label}{' '}
                {required && <span style={{ color: CLAY }}>· REQUIRED</span>}
            </label>
            {hint && (
                <p
                    className="font-mono"
                    style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.5 }}
                >
                    <span style={{ color: TEXT_DIM }}>// </span>
                    {hint}
                </p>
            )}
            {children}
        </div>
    );
}

function ExtraField({
    keyName,
    value,
    onChange,
    required,
    disabled,
}: {
    keyName: string;
    value: string;
    onChange: (v: string) => void;
    required: boolean;
    disabled: boolean;
}) {
    const cfg = fieldConfig(keyName);
    const inputType = cfg.type === 'url' ? 'url' : 'text';

    return (
        <Field label={cfg.label} required={required}>
            {cfg.type === 'text' ? (
                <textarea
                    placeholder={cfg.placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    required={required}
                    rows={3}
                    className="border-input dark:bg-input/30 placeholder:text-muted-foreground w-full rounded-md border bg-transparent px-3 py-2 font-sans text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
                />
            ) : (
                <Input
                    type={inputType}
                    placeholder={cfg.placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    required={required}
                    className="font-mono"
                />
            )}
        </Field>
    );
}
