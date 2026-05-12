import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DashboardContent } from '@/components/dashboard/DashboardContent';
import { AuthRequiredModal } from '@/components/shared/AuthRequiredModal';
import { DualAxisHero } from '@/components/profile/DualAxisHero';
import { ShareScoreButton } from '@/components/profile/ShareScoreButton';
import { LiveHackathonsBanner } from '@/components/hackathons/LiveHackathonsBanner';

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
