import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { TrackedIssuesDashboard } from '@/components/issues/TrackedIssuesDashboard';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { AuthRequiredModal } from '@/components/shared/AuthRequiredModal';
import { isDeveloperSession } from '@/lib/dev-guard';

export default async function MyIssuesPage() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    if (!session?.user) {
        return (
            <DashboardLayout>
                <AuthRequiredModal
                    title="Sign in to track issues"
                    message="Track issues you're working on and submit PRs for verification."
                />
            </DashboardLayout>
        );
    }

    if (!(await isDeveloperSession(session))) {
        return (
            <DashboardLayout>
                <AuthRequiredModal
                    title="Link your GitHub to track issues"
                    message="You're signed in as a hackathon organizer. Issue tracking ties contributions to a GitHub account — link yours to start tracking."
                />
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <main className="w-full px-8 py-8">
                <div className="mb-6">
                    <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted-foreground mb-2">
                        <span className="text-primary">*</span> ISSUES <span className="opacity-60">·</span> TRACKED_CONTRIBUTIONS
                    </div>
                    <h1 className="text-2xl font-semibold mb-1 tracking-tight">My Issues</h1>
                    <p className="text-muted-foreground">
                        Track issues you&apos;re working on and submit your PRs for verification.
                    </p>
                </div>

                <TrackedIssuesDashboard userId={session.user.id} />
            </main>
        </DashboardLayout>
    );
}
