/**
 * /hackathons/[slug]/admin/submission/[submissionId]
 *
 * Organizer/judge-tier full audit detail for one submission. Renders the
 * same content as DevProof's developer-facing ProjectDetailPanel (claims
 * with file:line evidence, architecture patterns, skills, forensics,
 * score breakdown), but on a dedicated page instead of a modal — judges
 * usually keep this open for a while comparing notes.
 *
 * When the organizer has enabled the per-event `show_sponsor_evidence`
 * setting, a Sponsor Evidence section also appears showing exactly where
 * each sponsor's packages are used in the code.
 *
 * Pure read-side — never re-runs the audit; consumes the v4_output JSON
 * the algo already produced for the dev-side flow.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { ScoreBreakdownChart } from '@/components/shared/ScoreBreakdownChart';
import { VerifiedClaimsSection } from '@/components/shared/VerifiedClaimsSection';
import { ArchitecturePatternsSection } from '@/components/shared/ArchitecturePatternsSection';
import { SkillsDemonstratedSection } from '@/components/shared/SkillsDemonstratedSection';
import { HackathonAdminLayout } from '@/components/layout/HackathonAdminLayout';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, GitCommit } from 'lucide-react';

const TEXT_DIM = '#666666';
const CLAY = '#CC785C';

interface SubmissionFullPayload {
    submission: {
        submission_id: string;
        submitter_user_id: string;
        github_url: string;
        team_members: string[];
        extras: Record<string, unknown>;
        matched_sponsors: Record<string, number>;
        submission_status: string;
        audit_status: string;
        audit_error: string | null;
        submitted_at: string | null;
    };
    audit: {
        v4_score: number | null;
        v4_tier: string | null;
        v4_output: V4OutputBlob | Record<string, never>;
        complexity_tier: string | null;
    };
    show_sponsor_evidence: boolean;
    sponsor_evidence: Record<string, SponsorEvidenceClaim[]> | null;
}

interface SponsorEvidenceClaim {
    package: string;
    claim_summary: string;
    tier: string | null;
    feature_type: string | null;
    evidence_files: string[];
    evidence_lines: number[];
    cross_file: boolean;
}

// Loose typing for V4 output — same shape the dev side consumes but
// adapted to the read-side. We only access well-known fields.
interface V4OutputBlob {
    repo_score?: number;
    repo_tier?: string;
    claims?: unknown[];
    architecture?: { detected_patterns?: unknown[] };
    score_breakdown?: {
        features?: { score?: number };
        architecture?: { score?: number };
        intent_and_standards?: { score?: number };
        forensics?: { score?: number };
    };
}

const tierConfig: Record<string, { color: string; bg: string }> = {
    ELITE: { color: '#a855f7', bg: 'rgba(168,85,247,0.08)' },
    ADVANCED: { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
    INTERMEDIATE: { color: '#10b981', bg: 'rgba(16,185,129,0.08)' },
    BASIC: { color: '#737373', bg: 'rgba(115,115,115,0.08)' },
};

async function fetchFull(
    origin: string,
    slug: string,
    submissionId: string,
): Promise<SubmissionFullPayload | null> {
    try {
        const hdrs = await headers();
        const cookie = hdrs.get('cookie') ?? '';
        const res = await fetch(
            `${origin}/api/hackathons-proxy/${encodeURIComponent(slug)}/admin/submissions/${encodeURIComponent(submissionId)}/full`,
            { cache: 'no-store', headers: { cookie } },
        );
        if (!res.ok) return null;
        return (await res.json()) as SubmissionFullPayload;
    } catch {
        return null;
    }
}

export default async function SubmissionDetailPage({
    params,
}: {
    params: Promise<{ slug: string; submissionId: string }>;
}) {
    const { slug, submissionId } = await params;
    const hdrs = await headers();
    const proto = hdrs.get('x-forwarded-proto') || 'http';
    const host = hdrs.get('host') || 'localhost:3000';
    const origin = `${proto}://${host}`;

    const data = await fetchFull(origin, slug, submissionId);

    if (!data) {
        return (
            <HackathonAdminLayout>
                <div className="mx-auto max-w-3xl px-6 py-20 text-center">
                    <h1 className="text-2xl font-semibold">Submission not found</h1>
                    <p className="mt-3 text-sm" style={{ color: TEXT_DIM }}>
                        Either it doesn't exist or you don't have access.
                    </p>
                    <Link
                        href={`/hackathons/${slug}/admin/judges`}
                        className="mt-6 inline-block text-sm underline"
                        style={{ color: CLAY }}
                    >
                        Back to judges scores
                    </Link>
                </div>
            </HackathonAdminLayout>
        );
    }

    const { submission, audit, sponsor_evidence, show_sponsor_evidence } = data;
    const v4 = audit.v4_output as V4OutputBlob;
    const score = audit.v4_score ?? v4?.repo_score ?? 0;
    const tier = (audit.v4_tier || v4?.repo_tier || 'BASIC').toUpperCase();
    const tierStyle = tierConfig[tier] || tierConfig.BASIC;
    const breakdown = v4?.score_breakdown;
    const claims = (v4?.claims as Parameters<typeof VerifiedClaimsSection>[0]['claims']) || [];
    const patterns = (v4?.architecture?.detected_patterns as Parameters<typeof ArchitecturePatternsSection>[0]['patterns']) || [];
    const repoShort = submission.github_url.replace('https://github.com/', '');

    return (
        <HackathonAdminLayout>
            <main className="mx-auto max-w-5xl px-6 py-12">
                <header className="mb-8">
                    <Link
                        href={`/hackathons/${slug}/admin/judges`}
                        className="text-xs uppercase tracking-widest"
                        style={{ color: TEXT_DIM }}
                    >
                        ← Judges scores
                    </Link>
                    <div className="mt-4 flex items-baseline gap-3 flex-wrap">
                        <h1 className="text-2xl font-semibold tracking-tight">
                            @{submission.submitter_user_id}
                        </h1>
                        <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0"
                            style={{
                                color: tierStyle.color,
                                borderColor: `${tierStyle.color}40`,
                                backgroundColor: tierStyle.bg,
                            }}
                        >
                            {tier}
                        </Badge>
                        <span
                            className="font-mono text-xl font-bold"
                            style={{ color: tierStyle.color }}
                        >
                            {Math.round(score)}
                            <span className="text-sm ml-0.5" style={{ color: TEXT_DIM }}>
                                /100
                            </span>
                        </span>
                    </div>
                    <a
                        href={submission.github_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs hover:underline"
                        style={{ color: '#A1A1A1' }}
                    >
                        {repoShort}
                        <ExternalLink className="h-3 w-3" />
                    </a>
                    {submission.team_members.length > 1 && (
                        <p className="mt-1 text-xs" style={{ color: TEXT_DIM }}>
                            team: {submission.team_members.join(' · ')}
                        </p>
                    )}
                </header>

                {/* Audit status banner if not complete */}
                {submission.audit_status !== 'complete' && (
                    <div
                        className="rounded-md border p-4 mb-6 text-xs"
                        style={{
                            borderColor:
                                submission.audit_status === 'failed'
                                    ? 'rgba(239,68,68,0.4)'
                                    : 'rgba(245,158,11,0.4)',
                            background:
                                submission.audit_status === 'failed'
                                    ? 'rgba(239,68,68,0.05)'
                                    : 'rgba(245,158,11,0.05)',
                            color: submission.audit_status === 'failed' ? '#fca5a5' : '#fde68a',
                        }}
                    >
                        {submission.audit_status === 'failed' ? (
                            <>
                                <strong>Audit failed.</strong> {submission.audit_error || 'No detail available.'}
                            </>
                        ) : (
                            <>
                                Audit status: <strong>{submission.audit_status}</strong>. Score
                                + claims will appear once the audit completes.
                            </>
                        )}
                    </div>
                )}

                <div className="space-y-8">
                    {/* Score Breakdown */}
                    {breakdown && (
                        <section>
                            <h2
                                className="text-sm font-medium mb-3"
                                style={{ color: TEXT_DIM }}
                            >
                                Score Breakdown
                            </h2>
                            <div className="h-[260px] max-w-md mx-auto">
                                <ScoreBreakdownChart
                                    features={breakdown.features?.score ?? 0}
                                    architecture={breakdown.architecture?.score ?? 0}
                                    intent={breakdown.intent_and_standards?.score ?? 0}
                                    forensics={breakdown.forensics?.score ?? 0}
                                />
                            </div>
                        </section>
                    )}

                    {/* Verified Claims */}
                    {claims.length > 0 && <VerifiedClaimsSection claims={claims} />}

                    {/* Architecture Patterns */}
                    {patterns.length > 0 && (
                        <ArchitecturePatternsSection patterns={patterns} />
                    )}

                    {/* Skills Demonstrated */}
                    {claims.length > 0 && <SkillsDemonstratedSection claims={claims} />}

                    {/* Sponsor evidence (toggle-gated) */}
                    {show_sponsor_evidence && sponsor_evidence && (
                        <SponsorEvidenceBlock evidence={sponsor_evidence} />
                    )}

                    {/* Submission extras (description, demo URL, etc.) */}
                    {Object.keys(submission.extras).length > 0 && (
                        <section>
                            <h2
                                className="text-sm font-medium mb-3"
                                style={{ color: TEXT_DIM }}
                            >
                                Submission Extras
                            </h2>
                            <ul className="space-y-2">
                                {Object.entries(submission.extras).map(([k, v]) => (
                                    <li
                                        key={k}
                                        className="text-sm grid grid-cols-[150px_1fr] gap-3 pb-2 border-b"
                                        style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                                    >
                                        <span style={{ color: TEXT_DIM }}>{k}</span>
                                        <span style={{ color: '#EDEDED', wordBreak: 'break-word' }}>
                                            {typeof v === 'string' && /^https?:\/\//.test(v) ? (
                                                <a
                                                    href={v}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: CLAY, textDecoration: 'underline' }}
                                                >
                                                    {v}
                                                </a>
                                            ) : (
                                                String(v)
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>
            </main>
        </HackathonAdminLayout>
    );
}


function SponsorEvidenceBlock({
    evidence,
}: {
    evidence: Record<string, SponsorEvidenceClaim[]>;
}) {
    const entries = Object.entries(evidence);
    if (entries.length === 0) {
        return (
            <section>
                <h2 className="text-sm font-medium mb-3" style={{ color: TEXT_DIM }}>
                    Sponsor Evidence
                </h2>
                <p className="text-xs" style={{ color: TEXT_DIM }}>
                    No sponsor packages detected in this submission's audited code.
                </p>
            </section>
        );
    }

    return (
        <section>
            <h2 className="text-sm font-medium mb-3" style={{ color: TEXT_DIM }}>
                Sponsor Evidence
            </h2>
            <p className="text-xs mb-3" style={{ color: TEXT_DIM }}>
                Specific places in the code where each sponsor's packages are used.
                Read-only — does not affect the audit score.
            </p>
            <div className="space-y-3">
                {entries.map(([sponsorName, claims]) => (
                    <div
                        key={sponsorName}
                        className="rounded-md border p-4"
                        style={{ borderColor: 'rgba(204,120,92,0.30)', background: 'rgba(204,120,92,0.04)' }}
                    >
                        <div className="flex items-baseline justify-between gap-3 mb-2">
                            <h3 className="text-sm font-medium" style={{ color: CLAY }}>
                                {sponsorName}
                            </h3>
                            <span className="text-xs" style={{ color: TEXT_DIM }}>
                                {claims.length} use{claims.length === 1 ? '' : 's'}
                            </span>
                        </div>
                        <ul className="space-y-2">
                            {claims.map((c, i) => (
                                <li key={i} className="text-xs">
                                    <p className="text-[#EDEDED]">
                                        <span style={{ color: TEXT_DIM }}>↳</span>{' '}
                                        {c.claim_summary || '(no summary)'}
                                        {c.feature_type && (
                                            <span
                                                className="ml-2 px-1 py-0.5 text-[10px] uppercase tracking-wider"
                                                style={{
                                                    color: TEXT_DIM,
                                                    border: '1px solid rgba(255,255,255,0.10)',
                                                }}
                                            >
                                                {c.feature_type}
                                            </span>
                                        )}
                                    </p>
                                    {c.evidence_files.length > 0 && (
                                        <p
                                            className="font-mono mt-1 break-all"
                                            style={{ color: TEXT_DIM }}
                                        >
                                            {c.evidence_files.join(', ')}
                                            {c.evidence_lines.length > 0 &&
                                                ` :${c.evidence_lines.join(',')}`}
                                            {c.cross_file && (
                                                <span className="ml-2" style={{ color: CLAY }}>
                                                    cross-file
                                                </span>
                                            )}
                                        </p>
                                    )}
                                    <p className="text-[10px] mt-0.5" style={{ color: TEXT_DIM }}>
                                        package: <code>{c.package}</code>
                                    </p>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </section>
    );
}
