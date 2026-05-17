/**
 * /hackathons/[slug]/admin/sponsors — sponsor leaderboards.
 *
 * For each sponsor, ranks submissions by score (then match count) using
 * the `matched_sponsors` map on each admin submission row.
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { SponsorLeaderboardClient } from '@/components/hackathons/SponsorLeaderboardClient';
import { fetchHackathon, fetchAdminSubmissions} from '@/lib/hackathons';

export default async function HackathonSponsorsPage({
    params }: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const session = await auth.api.getSession({ headers: await headers() });
    const hasCookie = await(slug);
    if (!session?.user && !hasCookie) {
        redirect(`/hackathons/${slug}`);
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
        <SponsorLeaderboardClient
            hackathon={hackathon}
            submissions={submissions.submissions}
        />
    );
}
