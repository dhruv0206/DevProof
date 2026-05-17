'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

interface HackathonAdminLayoutProps {
    children: React.ReactNode;
    /** Event context shown on the right side of the top bar (e.g. event name). */
    eventLabel?: string;
}

/**
 * Standalone layout for hackathon organizer / judge / observer pages.
 *
 * Deliberately does NOT render the developer-side sidebar (Dashboard / My Issues
 * / Open Source Finder / Projects / Profile / GitHub Access). Organizers don't
 * need any of that — they're managing events, not auditing their own repos.
 *
 * Visual identity is "DevProof Hackathons" so the experience already feels
 * like a separate product even before we split to `hackathon.orenda.vision`.
 */
export function HackathonAdminLayout({ children, eventLabel }: HackathonAdminLayoutProps) {
    const router = useRouter();
    const { data: session } = useSession();
    const [signingOut, setSigningOut] = useState(false);

    const handleSignOut = async () => {
        setSigningOut(true);
        try {
            await signOut();
            router.push('/hackathons');
            router.refresh();
        } finally {
            setSigningOut(false);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <header
                className="sticky top-0 z-40 border-b backdrop-blur-sm bg-background/85"
                style={{ borderColor: 'rgba(255,255,255,0.06)' }}
            >
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
                    {/* Left — Brand */}
                    <Link
                        href="/hackathons/admin"
                        className="flex items-center gap-2 group"
                    >
                        <Image
                            src="/logo_transparent.png"
                            alt=""
                            width={28}
                            height={28}
                            className="object-contain"
                        />
                        <span className="text-sm font-semibold tracking-tight">
                            DevProof <span className="opacity-60">Hackathons</span>
                        </span>
                    </Link>

                    {/* Center — Event context (if provided) */}
                    {eventLabel && (
                        <div
                            className="hidden md:block text-xs uppercase tracking-widest truncate max-w-md"
                            style={{ color: '#888' }}
                            title={eventLabel}
                        >
                            {eventLabel}
                        </div>
                    )}

                    {/* Right — Theme toggle + Sign out / user */}
                    <div className="flex items-center gap-3">
                        <ThemeToggle />
                        {session?.user ? (
                            <>
                                <span
                                    className="hidden sm:inline text-xs"
                                    style={{ color: '#888' }}
                                >
                                    {session.user.name || session.user.email}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleSignOut}
                                    disabled={signingOut}
                                    className="text-xs rounded-md px-3 py-1.5 transition-colors hover:bg-white/[0.04]"
                                    style={{
                                        color: '#888',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                    }}
                                >
                                    {signingOut ? '...' : 'Sign out'}
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
            </header>

            <main>{children}</main>
        </div>
    );
}
