/**
 * /hackathons/[slug]/admin/judges — organizer view of all judge scores.
 *
 * Server-rendered list of submissions with aggregated judge scores:
 *   - avg score across all judges (0-10)
 *   - per-judge breakdown (name, score, notes, saved timestamp)
 *   - click a row to expand
 *
 * Read-only — organizers don't edit judges' scores from this view; they
 * use the Team tab to regenerate the judge link when they need a fresh
 * round.
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { HackathonAdminLayout } from '@/components/layout/HackathonAdminLayout';
import { JudgingResultsSection } from '@/components/hackathons/JudgingResultsSection';
import {
    fetchHackathon,
    fetchJudgeScores,
    fetchAdminSubmissions,
} from '@/lib/hackathons';

export const metadata: Metadata = {
    title: 'Judges scores · DevProof Hackathons',
};

const TEXT_DIM = '#666666';

interface PageProps {
    params: Promise<{ slug: string }>;
}

export default async function JudgesPage({ params }: PageProps) {
    const { slug } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
        redirect(`/hackathons/${slug}/admin`);
    }

    const [hackathon, judgeScores, submissions] = await Promise.all([
        fetchHackathon(slug),
        fetchJudgeScores(slug),
        fetchAdminSubmissions(slug, { sort: 'score_desc' }),
    ]);

    if (hackathon === null) {
        return (
            <HackathonAdminLayout>
                <div className="mx-auto max-w-3xl px-6 py-20 text-center">
                    <h1 className="text-2xl font-semibold">Hackathon not found</h1>
                    <p className="mt-3 text-sm" style={{ color: TEXT_DIM }}>
                        Either the slug is wrong or you don't have access.
                    </p>
                    <Link
                        href="/hackathons/admin"
                        className="mt-6 inline-block text-sm underline"
                        style={{ color: '#CC785C' }}
                    >
                        Back to my hackathons
                    </Link>
                </div>
            </HackathonAdminLayout>
        );
    }

    return (
        <HackathonAdminLayout eventLabel={hackathon.name}>
            <div className="mx-auto max-w-5xl px-6 py-12">
                <header className="mb-10">
                    <Link
                        href={`/hackathons/${slug}/admin`}
                        className="text-xs uppercase tracking-widest"
                        style={{ color: TEXT_DIM }}
                    >
                        ← {hackathon.name}
                    </Link>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                        Judges scores
                    </h1>
                    <p className="mt-2 text-sm" style={{ color: TEXT_DIM }}>
                        Live aggregate of every judge's scores + notes across
                        all submissions. Sorted by judge average (highest
                        first). Refresh to see new entries.
                    </p>
                </header>

                <JudgingResultsSection
                    judgeScores={judgeScores}
                    submissions={submissions?.submissions ?? []}
                    slug={slug}
                />
            </div>
        </HackathonAdminLayout>
    );
}
