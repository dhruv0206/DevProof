/**
 * /hackathons/[slug]/admin/login — code-paste gate for non-dev organizers.
 *
 * No GitHub OAuth required. The pasted code maps to
 * `hackathon.organizer_access_code` and grants admin access via an
 * httpOnly cookie scoped per-slug. Devs who happen to have an organizer
 * role on this event can skip this page entirely — they're picked up via
 * the existing X-User-Id auth path.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LandingNavbar } from '@/components/landing/LandingNavbar';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { AdminLoginForm } from '@/components/hackathons/AdminLoginForm';
import { fetchHackathon, hasAdminCookie } from '@/lib/hackathons';

const TEXT_DIM = '#666666';
const CORNER = 'rgba(255,255,255,0.18)';

export default async function HackathonAdminLoginPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;

    // Already authed via cookie OR via GitHub-organizer-role? Skip the form.
    if (await hasAdminCookie(slug)) {
        redirect(`/hackathons/${slug}/admin`);
    }
    const event = await fetchHackathon(slug);
    if (event && (event.your_role === 'organizer' || event.your_role === 'judge')) {
        redirect(`/hackathons/${slug}/admin`);
    }

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <LandingNavbar />
            <main className="container mx-auto px-4 max-w-md pt-32 pb-20 flex-1 w-full">
                <div
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        color: TEXT_DIM,
                        textTransform: 'uppercase',
                        marginBottom: 14,
                        display: 'flex',
                        gap: 8,
                    }}
                >
                    <span>HACKATHON</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>ADMIN_LOGIN</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'stretch', gap: 14, marginBottom: 18 }}>
                    <div style={{ width: 2, background: '#EDEDED', flexShrink: 0 }} />
                    <h1
                        className="font-mono"
                        style={{
                            fontSize: 24,
                            fontWeight: 500,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                            paddingTop: 2,
                            color: '#EDEDED',
                        }}
                    >
                        ▌{event?.name ?? slug}
                    </h1>
                </div>

                <p
                    className="font-mono"
                    style={{
                        fontSize: 12,
                        color: TEXT_DIM,
                        lineHeight: 1.65,
                        marginBottom: 22,
                    }}
                >
                    <span style={{ color: TEXT_DIM }}>// </span>
                    Organizer-only. Paste the admin code we emailed when your event was
                    provisioned. No GitHub account required.
                </p>

                <div
                    style={{
                        position: 'relative',
                        padding: '28px 24px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.06)',
                    }}
                >
                    <span style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderLeft: `1px solid ${CORNER}`, pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${CORNER}`, borderRight: `1px solid ${CORNER}`, pointerEvents: 'none' }} />

                    <AdminLoginForm slug={slug} />
                </div>

                <div style={{ marginTop: 28, fontSize: 11 }}>
                    <Link
                        href={`/hackathons/${slug}`}
                        className="font-mono text-muted-foreground hover:text-foreground"
                        style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}
                    >
                        ← BACK_TO_EVENT
                    </Link>
                </div>
            </main>
            <LandingFooter />
        </div>
    );
}
