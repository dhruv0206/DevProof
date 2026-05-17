import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { HackathonAdminLayout } from '@/components/layout/HackathonAdminLayout';
import { PlatformAdminReissueButton } from '@/components/hackathons/PlatformAdminReissueButton';
import { PlatformAdminCreateButton } from '@/components/hackathons/PlatformAdminCreateButton';
import { fetchMyAdminHackathons, type AdminHackathonSummary } from '@/lib/hackathons';

/**
 * `/hackathons/admin` — Multi-hackathon dashboard for organizers.
 *
 * Lists every hackathon where the signed-in user has the ORGANIZER role.
 * Each row links into that event's admin dashboard at
 * `/hackathons/<slug>/admin`. Requires authentication; redirects to login
 * otherwise.
 */

export const metadata: Metadata = {
    title: 'My hackathons (admin) · DevProof',
    description: 'Manage hackathons where you are an organizer.',
};

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

export default async function AdminHackathonsPage() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
        // Platform admins sign in here; organizers arrive via magic link
        // which mints a session and then bounces them into the per-event
        // admin route directly — they never see this page unsigned.
        redirect('/hackathons/admin/login?next=/hackathons/admin');
    }

    const { hackathons, isPlatformAdmin } = await fetchMyAdminHackathons();

    // Plug the dev-side leak: a user who's signed in (likely via GitHub on
    // the developer side) but has no hackathon-side role AND isn't a
    // platform admin shouldn't see this surface. Send them to the public
    // hackathon index instead.
    if (!isPlatformAdmin && hackathons.length === 0) {
        redirect('/hackathons');
    }

    const heading = isPlatformAdmin
        ? 'Hackathons (all)'
        : 'Hackathons you organize';
    const subheading = isPlatformAdmin
        ? 'Platform admin · every event on DevProof. Provision new clients with the button on the right.'
        : 'Manage events, invite judges and co-organizers, and track submissions.';

    return (
        <HackathonAdminLayout>
            <div className="mx-auto max-w-5xl px-6 py-12">
                <header className="mb-10 flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight">
                            {heading}
                        </h1>
                        <p className="mt-2 text-sm" style={{ color: TEXT_DIM }}>
                            {subheading}
                        </p>
                    </div>
                    {isPlatformAdmin && <PlatformAdminCreateButton />}
                </header>

                {hackathons.length === 0 ? (
                    <EmptyState />
                ) : (
                    <ul className="space-y-3">
                        {hackathons.map((h) => (
                            <HackathonRow
                                key={h.id}
                                hackathon={h}
                                isPlatformAdmin={isPlatformAdmin}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </HackathonAdminLayout>
    );
}


function EmptyState() {
    return (
        <div
            className="rounded-lg border p-8 text-center"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
        >
            <h2 className="text-lg font-medium">No hackathons yet</h2>
            <p className="mt-2 text-sm" style={{ color: TEXT_DIM }}>
                You haven't been added as an organizer to any hackathons.
                If you want to host one, get in touch — we'll set it up
                and send you a magic link.
            </p>
            <a
                href="mailto:hello@devproof.app?subject=I%20want%20to%20host%20a%20hackathon"
                className="mt-4 inline-block rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: CLAY }}
            >
                Request to host
            </a>
        </div>
    );
}


function HackathonRow({
    hackathon,
    isPlatformAdmin,
}: {
    hackathon: AdminHackathonSummary;
    isPlatformAdmin: boolean;
}) {
    const status = hackathonStatus(hackathon);
    return (
        <li
            className="rounded-lg border transition-colors hover:bg-white/[0.02]"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
        >
            <div className="flex items-center justify-between p-5 gap-4">
                <Link
                    href={`/hackathons/${hackathon.slug}/admin`}
                    className="flex-1 min-w-0"
                >
                    <div className="flex items-center gap-3">
                        <h3 className="text-base font-medium truncate">
                            {hackathon.name}
                        </h3>
                        <StatusBadge status={status} />
                    </div>
                    <p
                        className="mt-1 text-xs"
                        style={{ color: TEXT_DIM }}
                    >
                        {hackathon.slug} · {hackathon.team_count} team {hackathon.team_count === 1 ? 'member' : 'members'} · {hackathon.submission_count} submission{hackathon.submission_count === 1 ? '' : 's'}
                    </p>
                </Link>
                <div
                    className="text-sm whitespace-nowrap"
                    style={{ color: TEXT_DIM }}
                >
                    {formatDateRange(hackathon.starts_at, hackathon.ends_at)}
                </div>
                {isPlatformAdmin && (
                    <PlatformAdminReissueButton
                        slug={hackathon.slug}
                        name={hackathon.name}
                    />
                )}
            </div>
        </li>
    );
}


function StatusBadge({ status }: { status: ReturnType<typeof hackathonStatus> }) {
    const colors: Record<typeof status, { bg: string; fg: string }> = {
        upcoming: { bg: 'rgba(204,120,92,0.15)', fg: CLAY },
        live: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
        ended: { bg: 'rgba(255,255,255,0.05)', fg: TEXT_DIM },
        published: { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6' },
        unscheduled: { bg: 'rgba(255,255,255,0.04)', fg: TEXT_DIM },
    };
    const c = colors[status];
    return (
        <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{ backgroundColor: c.bg, color: c.fg }}
        >
            {status}
        </span>
    );
}


function hackathonStatus(h: AdminHackathonSummary): 'upcoming' | 'live' | 'ended' | 'published' | 'unscheduled' {
    if (h.published_at) return 'published';
    if (!h.starts_at && !h.ends_at) return 'unscheduled';
    const now = Date.now();
    const starts = h.starts_at ? new Date(h.starts_at).getTime() : null;
    const ends = h.ends_at ? new Date(h.ends_at).getTime() : null;
    if (starts !== null && now < starts) return 'upcoming';
    if (ends !== null && now > ends) return 'ended';
    return 'live';
}


function formatDateRange(starts: string | null, ends: string | null): string {
    if (!starts && !ends) return 'No dates set';
    const fmt = (s: string) =>
        new Date(s).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
        });
    if (starts && ends) return `${fmt(starts)} – ${fmt(ends)}`;
    if (starts) return `Starts ${fmt(starts)}`;
    return `Ends ${fmt(ends!)}`;
}
