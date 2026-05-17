/**
 * /hackathons/[slug]/admin/judge — judging detail view.
 *
 * Reuses the admin submissions list to power a primary + compare selector.
 * Full claim-level breakdown will plug in once Track A exposes a per-
 * submission V4 output endpoint (the contracts doc only references it
 * for the dev's own polling endpoint #6 today).
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { JudgeViewClient } from '@/components/hackathons/JudgeViewClient';
import { fetchHackathon, fetchAdminSubmissions} from '@/lib/hackathons';

export default async function HackathonJudgePage({
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
                <div className="max-w-md w-full font-mono text-center">
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-3">
                        STATUS · 404
                    </div>
                    <h1 className="text-2xl font-semibold mb-2">Hackathon not found</h1>
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
                <div className="max-w-md w-full font-mono text-center">
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-3">
                        STATUS · ERROR
                    </div>
                    <h1 className="text-2xl font-semibold mb-2">
                        Couldn&apos;t load submissions
                    </h1>
                </div>
            </main>
        );
    }

    return (
        <JudgeViewClient
            hackathon={hackathon}
            submissions={submissions.submissions}
        />
    );
}
