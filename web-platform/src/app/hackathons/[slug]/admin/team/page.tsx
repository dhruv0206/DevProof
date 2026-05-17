import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import Link from 'next/link';
import { HackathonAdminLayout } from '@/components/layout/HackathonAdminLayout';
import { TeamManagementClient } from '@/components/hackathons/TeamManagementClient';
import { fetchHackathon, fetchTeam, fetchInvites} from '@/lib/hackathons';

export const metadata: Metadata = {
    title: 'Team · DevProof Hackathons' };

const TEXT_DIM = '#666666';

interface PageProps {
    params: Promise<{ slug: string }>;
}

/**
 * `/hackathons/<slug>/admin/team` — Team & invite management.
 *
 * Organizer-only page that lists the current team and pending invites,
 * and lets the organizer create new magic-link invites or revoke/edit
 * existing access. Fetches both team + invites server-side so the
 * initial render is hydrated.
 */
export default async function TeamPage({ params }: PageProps) {
    const { slug } = await params;

    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user?.id) {
        return (
            <HackathonAdminLayout>
                <div className="mx-auto max-w-3xl px-6 py-20 text-center">
                    <h1 className="text-2xl font-semibold">Access required</h1>
                    <p className="mt-3 text-sm" style={{ color: TEXT_DIM }}>
                        You need organizer access to manage this hackathon's team.
                        Open the magic link sent to you by DevProof.
                    </p>
                </div>
            </HackathonAdminLayout>
        );
    }

    const [hackathon, team, invites] = await Promise.all([
        fetchHackathon(slug),
        fetchTeam(slug),
        fetchInvites(slug),
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
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight">Team</h1>
                    <p className="mt-2 text-sm" style={{ color: TEXT_DIM }}>
                        Invite co-organizers, judges, and observers. Each invite generates
                        a one-time magic link you can share via email or Slack.
                    </p>
                </header>

                <TeamManagementClient
                    slug={slug}
                    initialTeam={team}
                    initialInvites={invites}
                />
            </div>
        </HackathonAdminLayout>
    );
}
