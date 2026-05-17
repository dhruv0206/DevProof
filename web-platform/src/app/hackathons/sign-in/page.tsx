/**
 * /hackathons/sign-in — self-serve magic-link request.
 *
 * Organizers, judges, and observers come here when they've lost their
 * session (cleared cookies, new device, session expired).  They enter
 * their email, we mint a fresh single-use magic link and email it to
 * them.  No password to set, no platform admin involvement needed.
 *
 * Response is intentionally uniform ("check your inbox") whether the
 * email is registered or not — prevents enumeration probing.
 *
 * Platform admins should NOT use this page; they sign in with their
 * password at `/hackathons/admin/login`.
 */

'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { HackathonAdminLayout } from '@/components/layout/HackathonAdminLayout';

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';

export default function HackathonSignInPage() {
    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [sent, setSent] = useState(false);
    const [devLink, setDevLink] = useState<string | null>(null);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSubmitting(true);
        setDevLink(null);
        try {
            const res = await fetch('/api/hackathons/auth/request-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            });
            const payload = (await res.json().catch(() => ({}))) as {
                dev_link?: string;
            };
            if (payload.dev_link) setDevLink(payload.dev_link);
        } catch {
            // Network errors fall through to the same "check your inbox"
            // message — don't reveal anything.
        }
        setSent(true);
        setSubmitting(false);
    };

    return (
        <HackathonAdminLayout>
            <div className="mx-auto max-w-md px-6 py-20">
                <header className="mb-8 text-center">
                    <div
                        className="font-mono text-[10px] uppercase tracking-[0.18em] mb-3"
                        style={{ color: TEXT_DIM }}
                    >
                        DEVPROOF · HACKATHONS
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Sign in
                    </h1>
                    <p
                        className="mt-2 text-sm"
                        style={{ color: TEXT_DIM }}
                    >
                        Enter the email your hackathon invite was sent to.
                        We'll email a single-use sign-in link.
                    </p>
                </header>

                {sent ? (
                    <div
                        className="rounded-md border p-6 text-center"
                        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                    >
                        <div
                            className="font-mono text-[10px] uppercase tracking-[0.18em] mb-3"
                            style={{ color: '#22c55e' }}
                        >
                            CHECK · YOUR · INBOX
                        </div>
                        <h2 className="text-base font-medium mb-2">
                            If that email has hackathon access, a sign-in
                            link is on its way.
                        </h2>
                        <p
                            className="text-xs leading-relaxed"
                            style={{ color: TEXT_DIM }}
                        >
                            The link works once and expires in 14 days.
                            Check your spam folder if you don't see it
                            within a minute.
                        </p>

                        {devLink && (
                            <div
                                className="mt-5 text-left rounded-md p-3"
                                style={{
                                    background: 'rgba(204,120,92,0.08)',
                                    border: '1px dashed rgba(204,120,92,0.4)',
                                }}
                            >
                                <div
                                    className="font-mono text-[10px] uppercase tracking-[0.18em] mb-2"
                                    style={{ color: CLAY }}
                                >
                                    DEV · BYPASS · EMAIL NOT SENT
                                </div>
                                <p className="text-xs mb-2" style={{ color: '#aaa' }}>
                                    No <code>RESEND_API_KEY</code> set —
                                    showing the link here so you don't
                                    have to dig through the terminal.
                                </p>
                                <a
                                    href={devLink}
                                    className="block text-xs font-mono break-all underline"
                                    style={{ color: CLAY }}
                                >
                                    {devLink}
                                </a>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={() => {
                                setSent(false);
                                setEmail('');
                                setDevLink(null);
                            }}
                            className="mt-5 text-xs underline"
                            style={{ color: TEXT_DIM }}
                        >
                            Use a different email
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
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
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={submitting}
                                className="w-full rounded-md px-3 py-2 text-sm bg-transparent outline-none transition-colors"
                                style={{
                                    border: '1px solid rgba(255,255,255,0.10)',
                                    color: '#EDEDED',
                                }}
                                placeholder="elsa@example.com"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={submitting || !email}
                            className="w-full rounded-md px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                                backgroundColor: CLAY,
                                color: '#fff',
                            }}
                        >
                            {submitting ? 'Sending…' : 'Send sign-in link'}
                        </button>
                    </form>
                )}

                <p
                    className="mt-10 text-center text-xs"
                    style={{ color: TEXT_DIM }}
                >
                    Platform admin?{' '}
                    <Link
                        href="/hackathons/admin/login"
                        className="underline"
                        style={{ color: '#888' }}
                    >
                        Sign in with password →
                    </Link>
                </p>
            </div>
        </HackathonAdminLayout>
    );
}
