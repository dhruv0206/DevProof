'use client';

/**
 * Client form for /hackathons/[slug]/submit.
 *
 * - GitHub URL is always required.
 * - Per-event extras: required + optional fields, driven by
 *   `event.settings.extras_required` / `extras_optional`.
 * - Team members: chip-style input (text + Enter / comma to commit).
 *   Submitter excluded automatically by backend.
 *
 * On 201, redirect to /me. On 409 (already submitted), redirect to /me too
 * — the user can edit there. Other errors surface inline.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TEXT_DIM = '#666666';

const EXTRA_FIELD_LABELS: Record<string, { label: string; placeholder: string; type: 'url' | 'text' | 'tags' }> = {
    deployed_url: { label: 'DEPLOYED_URL', placeholder: 'https://your-app.vercel.app', type: 'url' },
    demo_video_url: { label: 'DEMO_VIDEO_URL', placeholder: 'https://youtu.be/...', type: 'url' },
    slide_deck_url: { label: 'SLIDE_DECK_URL', placeholder: 'https://...', type: 'url' },
    description: { label: 'DESCRIPTION', placeholder: 'What you built and why', type: 'text' },
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

export function SubmitForm({
    slug,
    extrasRequired,
    extrasOptional,
    maxTeamSize,
    userId,
}: {
    slug: string;
    extrasRequired: string[];
    extrasOptional: string[];
    maxTeamSize: number | null;
    userId: string;
}) {
    const [githubUrl, setGithubUrl] = useState('');
    const [extras, setExtras] = useState<Record<string, string>>({});
    const [teamInput, setTeamInput] = useState('');
    const [team, setTeam] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const setExtra = (key: string, value: string) => {
        setExtras((prev) => ({ ...prev, [key]: value }));
    };

    const commitTeamChip = () => {
        const candidate = teamInput.trim().replace(/^@/, '').replace(/,$/, '');
        if (!candidate) return;
        if (team.includes(candidate)) {
            setTeamInput('');
            return;
        }
        if (maxTeamSize && team.length + 1 >= maxTeamSize) {
            // submitter is implicitly +1, so cap the chip list at max-1
            setError(`Team is capped at ${maxTeamSize} (submitter included).`);
            setTeamInput('');
            return;
        }
        setTeam([...team, candidate]);
        setTeamInput('');
    };

    const removeTeamChip = (name: string) => {
        setTeam(team.filter((n) => n !== name));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setError(null);

        if (!githubUrl.trim()) {
            setError('GitHub URL is required.');
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
            const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

            // Coerce tag fields from comma strings to string[].
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

            const res = await fetch(
                `${API_URL}/api/hackathons/${encodeURIComponent(slug)}/submissions`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
                    body: JSON.stringify({
                        github_url: githubUrl.trim(),
                        extras: builtExtras,
                        team_members: team,
                    }),
                },
            );

            if (res.ok || res.status === 409) {
                // 409 = already submitted — surface their existing submission
                // by redirecting to /me which loads it via your_submission_id.
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
        <form onSubmit={handleSubmit} className="space-y-7">
            {/* GitHub URL */}
            <div className="space-y-2">
                <label
                    htmlFor="github_url"
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: TEXT_DIM,
                        display: 'block',
                    }}
                >
                    GITHUB_URL <span style={{ color: '#CC785C' }}>·</span> REQUIRED
                </label>
                <Input
                    id="github_url"
                    type="url"
                    placeholder="https://github.com/team/project"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    disabled={submitting}
                    autoFocus
                    required
                    className="font-mono"
                />
            </div>

            {/* Required extras */}
            {extrasRequired.length > 0 && (
                <div className="space-y-5">
                    <div className="h-px bg-border" />
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            color: TEXT_DIM,
                            textTransform: 'uppercase',
                        }}
                    >
                        REQUIRED <span style={{ opacity: 0.6 }}>·</span>{' '}
                        <span style={{ color: '#A1A1A1', fontVariantNumeric: 'tabular-nums' }}>
                            {String(extrasRequired.length).padStart(2, '0')}
                        </span>
                    </div>
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
                </div>
            )}

            {/* Optional extras */}
            {extrasOptional.length > 0 && (
                <div className="space-y-5">
                    <div className="h-px bg-border" />
                    <div
                        className="font-mono"
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            color: TEXT_DIM,
                            textTransform: 'uppercase',
                        }}
                    >
                        OPTIONAL <span style={{ opacity: 0.6 }}>·</span>{' '}
                        <span style={{ color: '#A1A1A1', fontVariantNumeric: 'tabular-nums' }}>
                            {String(extrasOptional.length).padStart(2, '0')}
                        </span>
                    </div>
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
                </div>
            )}

            {/* Team members */}
            <div className="space-y-2">
                <div className="h-px bg-border" />
                <div style={{ height: 16 }} />
                <label
                    htmlFor="team_members"
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: TEXT_DIM,
                        display: 'block',
                    }}
                >
                    TEAM_MEMBERS{' '}
                    <span style={{ opacity: 0.6 }}>·</span>{' '}
                    <span style={{ color: '#A1A1A1' }}>GITHUB_USERNAMES</span>
                </label>
                <p
                    className="font-mono"
                    style={{ fontSize: 11, color: TEXT_DIM, lineHeight: 1.5 }}
                >
                    <span style={{ color: TEXT_DIM }}>// </span>
                    Press Enter or comma to add. You&apos;re included automatically.
                </p>
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        padding: team.length > 0 ? '8px' : 0,
                        border: team.length > 0 ? '1px solid rgba(255,255,255,0.08)' : undefined,
                    }}
                >
                    {team.map((name) => (
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
                    id="team_members"
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
                        } else if (e.key === 'Backspace' && !teamInput && team.length > 0) {
                            removeTeamChip(team[team.length - 1]);
                        }
                    }}
                    disabled={submitting}
                    className="font-mono"
                />
            </div>

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

            <Button type="submit" className="w-full gap-2" size="lg" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? 'Submitting…' : 'Submit project →'}
            </Button>
        </form>
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
        <div className="space-y-2">
            <label
                htmlFor={`extra_${keyName}`}
                className="font-mono"
                style={{
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: TEXT_DIM,
                    display: 'block',
                }}
            >
                {cfg.label}{' '}
                {required && <span style={{ color: '#CC785C' }}>· REQUIRED</span>}
            </label>
            {cfg.type === 'text' ? (
                <textarea
                    id={`extra_${keyName}`}
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
                    id={`extra_${keyName}`}
                    type={inputType}
                    placeholder={cfg.placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    required={required}
                    className="font-mono"
                />
            )}
        </div>
    );
}
