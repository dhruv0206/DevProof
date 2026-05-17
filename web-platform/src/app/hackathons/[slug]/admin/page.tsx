/**
 * /hackathons/[slug]/admin — organizer/judge submissions dashboard.
 *
 * Server component:
 * - Verifies BetterAuth session.
 * - Fetches the hackathon and checks `your_role` is organizer | judge.
 * - Fetches the admin submissions list and hands off to a client
 *   component for filter / sort / search / publish / CSV export.
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { AdminDashboardClient } from '@/components/hackathons/AdminDashboardClient';
import { HackathonAdminLayout } from '@/components/layout/HackathonAdminLayout';
import {
    fetchHackathon,
    fetchAdminSubmissions
} from '@/lib/hackathons';

export default async function HackathonAdminPage({
    params }: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        // DO NOT auto-bounce to /hackathons/admin/login — that's the
        // email+password page reserved for PLATFORM admins (DevProof
        // staff). Organizers and judges have no password; they get in
        // via a magic link. Show a friendly disambiguation page so
        // each audience can pick their correct path.
        return (
            <HackathonAdminLayout>
                <main className="min-h-[60vh] flex items-center justify-center px-4">
                    <div className="max-w-md w-full text-center">
                        <div className="font-mono text-xs uppercase tracking-[0.18em] mb-3" style={{ color: '#888' }}>
                            ACCESS · REQUIRED
                        </div>
                        <h1 className="text-2xl font-semibold mb-2">Sign in to access this event</h1>
                        <p className="text-sm mb-8" style={{ color: '#888' }}>
                            You need to be signed in as an organizer, judge,
                            or platform admin to view this dashboard.
                        </p>

                        <div className="text-left rounded-md border p-5 mb-4" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
                            <div className="text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#888' }}>
                                Organizer / Judge
                            </div>
                            <p className="text-sm mb-3" style={{ color: '#aaa' }}>
                                Use the magic link sent to your email by the
                                DevProof team. Each link is single-use, so if
                                you've already used yours, ask the platform
                                admin for a fresh one.
                            </p>
                        </div>

                        <div className="text-left rounded-md border p-5" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
                            <div className="text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#888' }}>
                                Platform admin
                            </div>
                            <p className="text-sm mb-3" style={{ color: '#aaa' }}>
                                Sign in with your DevProof staff account.
                            </p>
                            <a
                                href={`/hackathons/admin/login?next=/hackathons/${slug}/admin`}
                                className="inline-block rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                                style={{ backgroundColor: '#CC785C' }}
                            >
                                Go to admin sign-in →
                            </a>
                        </div>
                    </div>
                </main>
            </HackathonAdminLayout>
        );
    }

    const hackathon = await fetchHackathon(slug);
    if (!hackathon) {
        return (
            <HackathonAdminLayout>
                <main className="min-h-[60vh] flex items-center justify-center px-4">
                    <div className="max-w-md w-full font-mono text-center">
                        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-3">
                            STATUS · 404
                        </div>
                        <h1 className="text-2xl font-semibold mb-2">Hackathon not found</h1>
                        <p className="text-sm text-muted-foreground">
                            // no event registered for slug{' '}
                            <span className="text-foreground">{slug}</span>
                        </p>
                    </div>
                </main>
            </HackathonAdminLayout>
        );
    }

    if (
        hackathon.your_role !== 'organizer' &&
        hackathon.your_role !== 'judge'
    ) {
        redirect(`/hackathons/${slug}`);
    }

    const submissions = await fetchAdminSubmissions(slug, {
        sort: 'score_desc' });
    if (!submissions) {
        return (
            <HackathonAdminLayout eventLabel={hackathon.name}>
                <main className="min-h-[60vh] flex items-center justify-center px-4">
                    <div className="max-w-md w-full font-mono text-center">
                        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-3">
                            STATUS · ERROR
                        </div>
                        <h1 className="text-2xl font-semibold mb-2">
                            Couldn&apos;t load submissions
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            // backend admin endpoint unreachable
                        </p>
                    </div>
                </main>
            </HackathonAdminLayout>
        );
    }

    return (
        <HackathonAdminLayout eventLabel={hackathon.name}>
            <AdminDashboardClient
                hackathon={hackathon}
                initial={submissions}
                userId={session?.user?.id ?? null}
            />
        </HackathonAdminLayout>
    );
}
