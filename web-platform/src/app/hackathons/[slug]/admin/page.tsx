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
import {
    fetchHackathon,
    fetchAdminSubmissions,
    hasAdminCookie,
} from '@/lib/hackathons';

export default async function HackathonAdminPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    const hasCookie = await hasAdminCookie(slug);
    if (!session?.user && !hasCookie) {
        redirect(`/hackathons/${slug}/admin/login`);
    }

    const hackathon = await fetchHackathon(slug);
    if (!hackathon) {
        return (
            <main className="min-h-screen bg-background flex items-center justify-center px-4">
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
        );
    }

    // Cookie-auth users have no session-derived role — allow them through.
    if (
        !hasCookie &&
        hackathon.your_role !== 'organizer' &&
        hackathon.your_role !== 'judge'
    ) {
        redirect(`/hackathons/${slug}`);
    }

    const submissions = await fetchAdminSubmissions(slug, {
        sort: 'score_desc',
    });
    if (!submissions) {
        return (
            <main className="min-h-screen bg-background flex items-center justify-center px-4">
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
        );
    }

    return (
        <AdminDashboardClient
            hackathon={hackathon}
            initial={submissions}
            userId={session?.user?.id ?? null}
        />
    );
}
