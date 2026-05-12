/**
 * /hackathons/[slug]/admin/awards — assign prize categories.
 *
 * Local-state only for MVP — selections persist in localStorage scoped
 * to the hackathon slug. Wires to a backend endpoint once Track A
 * exposes one.
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { AwardsClient } from '@/components/hackathons/AwardsClient';
import { fetchHackathon, fetchAdminSubmissions, hasAdminCookie } from '@/lib/hackathons';

export default async function HackathonAwardsPage({
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
                <div className="font-mono text-center">
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-3">
                        STATUS · 404
                    </div>
                    <h1 className="text-2xl font-semibold">Hackathon not found</h1>
                </div>
            </main>
        );
    }
    if (
        !hasCookie &&
        hackathon.your_role !== 'organizer' &&
        hackathon.your_role !== 'judge'
    ) {
        redirect(`/hackathons/${slug}`);
    }

    const submissions = await fetchAdminSubmissions(slug, { sort: 'score_desc' });
    if (!submissions) {
        return (
            <main className="min-h-screen bg-background flex items-center justify-center px-4">
                <div className="font-mono text-center">
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-3">
                        STATUS · ERROR
                    </div>
                    <h1 className="text-2xl font-semibold">
                        Couldn&apos;t load submissions
                    </h1>
                </div>
            </main>
        );
    }

    return (
        <AwardsClient
            hackathon={hackathon}
            submissions={submissions.submissions}
        />
    );
}
