/**
 * /hackathons/[slug]/judge/[token] — shareable judge page.
 *
 * Anyone with the link can score submissions. No DevProof account needed.
 * Judge types their name once (localStorage), then writes scores + notes
 * per submission. The token is the credential.
 *
 * Server-side validates the token by fetching context; if invalid, renders
 * an error page. Otherwise hands off to the client component.
 */

import { headers } from 'next/headers';
import { JudgeScoringClient } from '@/components/hackathons/JudgeScoringClient';

interface JudgeSubmission {
    submission_id: string;
    submitter_user_id: string;
    github_url: string;
    team_members: string[];
    extras: Record<string, unknown>;
    matched_sponsors: Record<string, number>;
    audit_status: string;
    audit_error: string | null;
    repo_score: number | null;
    repo_tier: string | null;
    submitted_at: string | null;
}

interface JudgeContext {
    hackathon: {
        slug: string;
        name: string;
        submissions_close_at: string | null;
        ends_at: string | null;
    };
    submissions: JudgeSubmission[];
}

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

async function fetchContext(
    origin: string,
    slug: string,
    token: string,
): Promise<JudgeContext | null> {
    try {
        const res = await fetch(
            `${origin}/api/hackathons-proxy/${encodeURIComponent(slug)}/judge/${encodeURIComponent(token)}/context`,
            { cache: 'no-store' },
        );
        if (!res.ok) return null;
        return (await res.json()) as JudgeContext;
    } catch {
        return null;
    }
}

export default async function JudgePage({
    params,
}: {
    params: Promise<{ slug: string; token: string }>;
}) {
    const { slug, token } = await params;
    const hdrs = await headers();
    const proto = hdrs.get('x-forwarded-proto') || 'http';
    const host = hdrs.get('host') || 'localhost:3000';
    const origin = `${proto}://${host}`;

    const ctx = await fetchContext(origin, slug, token);
    if (!ctx) return <InvalidLinkPage />;

    return (
        <JudgeScoringClient
            slug={slug}
            token={token}
            hackathonName={ctx.hackathon.name}
            submissionsCloseAt={ctx.hackathon.submissions_close_at}
            submissions={ctx.submissions}
        />
    );
}


function InvalidLinkPage() {
    return (
        <main
            style={{
                minHeight: '100vh',
                background: '#0a0a0a',
                color: '#EDEDED',
                fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, sans-serif',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 2rem',
            }}
        >
            <div style={{ maxWidth: 480, textAlign: 'center' }}>
                <div
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: TEXT_DIM,
                        marginBottom: 12,
                    }}
                >
                    STATUS · LINK_INVALID
                </div>
                <h1
                    style={{
                        fontSize: 22,
                        fontWeight: 600,
                        letterSpacing: '-0.02em',
                        marginBottom: 12,
                    }}
                >
                    This judge link is invalid
                </h1>
                <p style={{ color: TEXT_DIM, fontSize: 14, lineHeight: 1.55 }}>
                    The organizer may have regenerated the link. Ask them for
                    the latest one.
                </p>
                <p style={{ marginTop: 16 }}>
                    <a
                        href="/hackathons"
                        style={{
                            color: CLAY,
                            fontSize: 13,
                            textDecoration: 'underline',
                        }}
                    >
                        Back to hackathons
                    </a>
                </p>
            </div>
        </main>
    );
}
