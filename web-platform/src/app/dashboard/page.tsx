import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DashboardContent } from '@/components/dashboard/DashboardContent';
import { AuthRequiredModal } from '@/components/shared/AuthRequiredModal';
import { DualAxisHero } from '@/components/profile/DualAxisHero';
import { ShareScoreButton } from '@/components/profile/ShareScoreButton';
import { LiveHackathonsBanner } from '@/components/hackathons/LiveHackathonsBanner';
import { isDeveloperSession } from '@/lib/dev-guard';

export default async function DashboardPage() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    if (!session?.user) {
        return (
            <DashboardLayout>
                <AuthRequiredModal
                    title="Sign in to access Dashboard"
                    message="Track your contributions, view stats, and manage your open source journey."
                />
            </DashboardLayout>
        );
    }

    // Organizer-only sessions (signed in via magic-link, no GitHub linkage)
    // can land on this page if they paste the URL or follow a stale link,
    // but the developer dashboard isn't meaningful without GitHub data.
    // Show the same sign-in CTA — clicking it links their GitHub on top
    // of their existing organizer identity (BetterAuth handles the merge).
    if (!(await isDeveloperSession(session))) {
        return (
            <DashboardLayout>
                <AuthRequiredModal
                    title="Link your GitHub to use the developer dashboard"
                    message="You're signed in as a hackathon organizer. Link your GitHub account to also use DevProof as a developer — your audits, profile, and contribution tracking will appear here."
                />
            </DashboardLayout>
        );
    }

    const githubUsername = session.user.name;

    return (
        <DashboardLayout>
            <main className="w-full px-6 lg:px-8 py-6">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-semibold">Dashboard</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Your development overview and progress
                        </p>
                    </div>
                    {githubUsername && <ShareScoreButton username={githubUsername} />}
                </div>

                <LiveHackathonsBanner />

                {githubUsername && (
                    <section className="mb-8">
                        <DualAxisHero username={githubUsername} />
                    </section>
                )}

                <DashboardContent userId={session.user.id} />
            </main>
        </DashboardLayout>
    );
}
