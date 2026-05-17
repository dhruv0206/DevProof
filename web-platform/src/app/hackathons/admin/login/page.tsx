/**
 * /hackathons/admin/login — email + password sign-in for platform admins.
 *
 * This is the ONLY sign-in surface that uses email + password. It exists so
 * platform owners (DevProof staff) can log into the hackathon admin side
 * without using their `dhruv0206` GitHub identity (which is the developer-
 * facing side of the platform).
 *
 * Organizers, judges, and observers DO NOT use this page — they sign in via
 * magic links sent by the platform owner. Participants (developers) sign in
 * with GitHub OAuth on the main app.
 *
 * Sign-up is disabled at the BetterAuth config level (`disableSignUp: true`)
 * so this form is sign-in only. Admins are provisioned via
 * `ai-engine/scripts/create_admin.py`.
 */

'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import { HackathonAdminLayout } from '@/components/layout/HackathonAdminLayout';

const CLAY = '#CC785C';
const TEXT_DIM = '#666666';

// Next.js 15+ requires components calling useSearchParams() to be inside a
// Suspense boundary; otherwise prerender fails at build time. Splitting the
// inner form out lets the outer default export provide that boundary while
// keeping the rest of the file unchanged.
export default function AdminLoginPage() {
    return (
        <Suspense fallback={null}>
            <AdminLoginInner />
        </Suspense>
    );
}

function AdminLoginInner() {
    const router = useRouter();
    const params = useSearchParams();
    const next = params.get('next') || '/hackathons/admin';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        const res = await signIn.email({
            email: email.trim(),
            password,
        });

        if (res.error) {
            setError(res.error.message || 'Sign in failed');
            setSubmitting(false);
            return;
        }

        router.replace(next);
        router.refresh();
    };

    return (
        <HackathonAdminLayout>
            <div className="mx-auto max-w-md px-6 py-20">
                <header className="mb-8 text-center">
                    <div
                        className="font-mono text-[10px] uppercase tracking-[0.18em] mb-3"
                        style={{ color: TEXT_DIM }}
                    >
                        DEVPROOF · HACKATHONS · ADMIN
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Sign in
                    </h1>
                    <p
                        className="mt-2 text-sm"
                        style={{ color: TEXT_DIM }}
                    >
                        Platform admin sign-in. Organizers should use the magic
                        link sent to their email.
                    </p>
                </header>

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
                            placeholder="you@orenda.vision"
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="password"
                            className="block text-xs font-medium mb-1.5"
                            style={{ color: TEXT_DIM }}
                        >
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={submitting}
                            className="w-full rounded-md px-3 py-2 text-sm bg-transparent outline-none transition-colors"
                            style={{
                                border: '1px solid rgba(255,255,255,0.10)',
                                color: '#EDEDED',
                            }}
                        />
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

                    <button
                        type="submit"
                        disabled={submitting || !email || !password}
                        className="w-full rounded-md px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            backgroundColor: CLAY,
                            color: '#fff',
                        }}
                    >
                        {submitting ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>

                <p
                    className="mt-8 text-center text-xs"
                    style={{ color: TEXT_DIM }}
                >
                    No account?{' '}
                    <span style={{ color: '#888' }}>
                        Admin accounts are CLI-provisioned only.
                    </span>
                </p>
            </div>
        </HackathonAdminLayout>
    );
}
