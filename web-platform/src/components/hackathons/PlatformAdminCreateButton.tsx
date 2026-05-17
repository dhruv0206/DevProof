/**
 * "Create hackathon" button shown in the header of /hackathons/admin when
 * the viewer is a platform admin.
 *
 * Opens a modal asking for organizer email + hackathon name/slug + optional
 * dates. On submit, the backend creates the User (if needed), the Hackathon,
 * the ORGANIZER role, and a magic-link invite — then returns the link. The
 * platform admin copies the link and shares it with the organizer
 * out-of-band (Slack, email, etc.). The platform admin never enters the
 * per-event admin UI.
 *
 * UI grammar mirrors PlatformAdminReissueButton so the two surfaces feel
 * like siblings: same modal styling, same clay copy button.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const CLAY = '#CC785C';
const TEXT_DIM = '#888';

interface ProvisionResponse {
    hackathon: {
        id: string;
        slug: string;
        name: string;
        access_code: string;
    };
    organizer: {
        user_id: string;
        email: string;
        name: string | null;
    };
    invite: {
        token: string;
        magic_link: string;
        expires_at: string;
    };
}

export function PlatformAdminCreateButton() {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [hackathonName, setHackathonName] = useState('');
    const [hackathonSlug, setHackathonSlug] = useState('');
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ProvisionResponse | null>(null);
    const [copiedField, setCopiedField] = useState<'link' | 'code' | null>(null);

    const reset = () => {
        setEmail('');
        setName('');
        setHackathonName('');
        setHackathonSlug('');
        setStartsAt('');
        setEndsAt('');
        setError(null);
        setResult(null);
        setCopiedField(null);
    };

    const close = () => {
        const hadResult = result !== null;
        setOpen(false);
        reset();
        // Refresh the hackathon list so the freshly-provisioned event appears
        // immediately. We only need to do this when something was actually
        // created (don't churn the network on a cancel-without-submitting).
        if (hadResult) router.refresh();
    };

    // Auto-derive slug from hackathon name as the user types, unless they've
    // already manually edited the slug field.
    const [slugIsAuto, setSlugIsAuto] = useState(true);
    const onHackathonNameChange = (v: string) => {
        setHackathonName(v);
        if (slugIsAuto) {
            const auto = v
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 80);
            setHackathonSlug(auto);
        }
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        const payload: Record<string, unknown> = {
            email: email.trim(),
            hackathon_slug: hackathonSlug.trim(),
            hackathon_name: hackathonName.trim(),
        };
        if (name.trim()) payload.name = name.trim();
        if (startsAt) payload.starts_at = new Date(startsAt).toISOString();
        if (endsAt) payload.ends_at = new Date(endsAt).toISOString();

        const res = await fetch(
            '/api/hackathons-proxy/platform-admin/provision-hackathon',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
        );

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError(
                typeof body?.detail === 'string'
                    ? body.detail
                    : `HTTP ${res.status}`,
            );
            setSubmitting(false);
            return;
        }

        const data = (await res.json()) as ProvisionResponse;
        setResult(data);
        setSubmitting(false);
    };

    const copy = async (value: string, which: 'link' | 'code') => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(which);
            setTimeout(() => setCopiedField(null), 1500);
        } catch {
            // older browsers — just ignore
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-sm rounded-md px-4 py-2 font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: CLAY }}
            >
                + Create hackathon
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
                            maxWidth: 560,
                            maxHeight: '90vh',
                            overflowY: 'auto',
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
                            PROVISION · NEW HACKATHON
                        </div>
                        <h3 className="text-lg font-semibold mb-1">
                            Create a hackathon
                        </h3>
                        <p
                            className="text-xs mb-5"
                            style={{ color: TEXT_DIM }}
                        >
                            Creates the event, the organizer&apos;s user
                            (if needed), the ORGANIZER role, and a magic-link
                            invite. You share the link with the organizer
                            out-of-band — they click it to claim access.
                        </p>

                        {result ? (
                            <ResultPanel
                                result={result}
                                copiedField={copiedField}
                                onCopy={copy}
                                onDone={close}
                            />
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-3.5">
                                <Field label="Organizer email" required>
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        disabled={submitting}
                                        placeholder="elsa@fomo.club"
                                        className="w-full rounded-md px-3 py-2 text-sm bg-transparent outline-none"
                                        style={{
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            color: '#EDEDED',
                                        }}
                                    />
                                </Field>
                                <Field
                                    label="Organizer display name"
                                    hint="Optional — defaults to the email's local part"
                                >
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        disabled={submitting}
                                        placeholder="Elsa Bismuth"
                                        className="w-full rounded-md px-3 py-2 text-sm bg-transparent outline-none"
                                        style={{
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            color: '#EDEDED',
                                        }}
                                    />
                                </Field>
                                <Field label="Hackathon name" required>
                                    <input
                                        type="text"
                                        required
                                        value={hackathonName}
                                        onChange={(e) => onHackathonNameChange(e.target.value)}
                                        disabled={submitting}
                                        placeholder="FOMO Munich 2026"
                                        className="w-full rounded-md px-3 py-2 text-sm bg-transparent outline-none"
                                        style={{
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            color: '#EDEDED',
                                        }}
                                    />
                                </Field>
                                <Field
                                    label="Slug"
                                    hint="URL-safe identifier — auto-derived from the name. Edit if needed."
                                    required
                                >
                                    <input
                                        type="text"
                                        required
                                        value={hackathonSlug}
                                        onChange={(e) => {
                                            setSlugIsAuto(false);
                                            setHackathonSlug(
                                                e.target.value
                                                    .toLowerCase()
                                                    .replace(/[^a-z0-9-]/g, ''),
                                            );
                                        }}
                                        disabled={submitting}
                                        placeholder="fomo-munich-2026"
                                        className="w-full rounded-md px-3 py-2 text-sm font-mono bg-transparent outline-none"
                                        style={{
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            color: '#EDEDED',
                                        }}
                                    />
                                </Field>
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: 12,
                                    }}
                                >
                                    <Field label="Starts" hint="Optional">
                                        <input
                                            type="datetime-local"
                                            value={startsAt}
                                            onChange={(e) => setStartsAt(e.target.value)}
                                            disabled={submitting}
                                            className="w-full rounded-md px-3 py-2 text-sm bg-transparent outline-none"
                                            style={{
                                                border: '1px solid rgba(255,255,255,0.10)',
                                                color: '#EDEDED',
                                            }}
                                        />
                                    </Field>
                                    <Field label="Ends" hint="Optional">
                                        <input
                                            type="datetime-local"
                                            value={endsAt}
                                            onChange={(e) => setEndsAt(e.target.value)}
                                            disabled={submitting}
                                            className="w-full rounded-md px-3 py-2 text-sm bg-transparent outline-none"
                                            style={{
                                                border: '1px solid rgba(255,255,255,0.10)',
                                                color: '#EDEDED',
                                            }}
                                        />
                                    </Field>
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
                                        disabled={
                                            submitting ||
                                            !email ||
                                            !hackathonName ||
                                            !hackathonSlug
                                        }
                                        className="text-xs rounded-md px-3 py-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
                                        style={{
                                            backgroundColor: CLAY,
                                            color: '#fff',
                                        }}
                                    >
                                        {submitting ? 'Provisioning…' : 'Create + mint link'}
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


function Field({
    label,
    hint,
    required,
    children,
}: {
    label: string;
    hint?: string;
    required?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div>
            <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: TEXT_DIM }}
            >
                {label}
                {required && (
                    <span style={{ color: CLAY, marginLeft: 4 }}>*</span>
                )}
            </label>
            {hint && (
                <p
                    className="text-[11px] mb-1.5"
                    style={{ color: TEXT_DIM, opacity: 0.75 }}
                >
                    {hint}
                </p>
            )}
            {children}
        </div>
    );
}


function ResultPanel({
    result,
    copiedField,
    onCopy,
    onDone,
}: {
    result: ProvisionResponse;
    copiedField: 'link' | 'code' | null;
    onCopy: (value: string, which: 'link' | 'code') => void;
    onDone: () => void;
}) {
    return (
        <div className="space-y-4">
            <div
                className="font-mono text-xs px-3 py-2 rounded-md"
                style={{
                    color: '#bef264',
                    background: 'rgba(132,204,22,0.06)',
                    border: '1px solid rgba(132,204,22,0.20)',
                }}
            >
                // hackathon &quot;{result.hackathon.name}&quot; provisioned
            </div>

            <div>
                <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: TEXT_DIM }}
                >
                    Magic link (share with the organizer)
                </label>
                <div className="flex gap-2 items-stretch">
                    <input
                        readOnly
                        value={result.invite.magic_link}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 rounded-md px-3 py-2 text-xs font-mono bg-transparent outline-none"
                        style={{
                            border: '1px solid rgba(255,255,255,0.10)',
                            color: '#EDEDED',
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => onCopy(result.invite.magic_link, 'link')}
                        className="text-xs rounded-md px-3 transition-opacity hover:opacity-90"
                        style={{
                            backgroundColor: CLAY,
                            color: '#fff',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {copiedField === 'link' ? 'Copied ✓' : 'Copy'}
                    </button>
                </div>
            </div>

            <div>
                <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: TEXT_DIM }}
                >
                    Developer join code (organizer shares with participants)
                </label>
                <div className="flex gap-2 items-stretch">
                    <input
                        readOnly
                        value={result.hackathon.access_code}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 rounded-md px-3 py-2 text-sm font-mono bg-transparent outline-none"
                        style={{
                            border: '1px solid rgba(255,255,255,0.10)',
                            color: '#EDEDED',
                            letterSpacing: '0.1em',
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => onCopy(result.hackathon.access_code, 'code')}
                        className="text-xs rounded-md px-3 transition-opacity hover:opacity-90"
                        style={{
                            border: '1px solid rgba(255,255,255,0.10)',
                            color: '#aaa',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {copiedField === 'code' ? 'Copied ✓' : 'Copy'}
                    </button>
                </div>
            </div>

            <p
                className="text-[11px]"
                style={{ color: TEXT_DIM, opacity: 0.75, lineHeight: 1.5 }}
            >
                The magic link expires in {invitationTtlDays(result.invite.expires_at)} days
                and can only be clicked once. After the organizer accepts, they land
                directly in their <code>/admin</code> dashboard.
            </p>

            <div className="flex justify-end pt-2">
                <button
                    type="button"
                    onClick={onDone}
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
    );
}

function invitationTtlDays(iso: string): number {
    const expires = new Date(iso).getTime();
    const days = Math.round((expires - Date.now()) / (1000 * 60 * 60 * 24));
    return Math.max(1, days);
}
