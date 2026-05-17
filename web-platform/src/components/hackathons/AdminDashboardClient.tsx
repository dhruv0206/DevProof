'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
    AdminFilterBar,
    type FilterState } from '@/components/hackathons/AdminFilterBar';
import {
    SubmissionRow,
    SubmissionRowHeader } from '@/components/hackathons/SubmissionRow';
import type {
    AdminSubmission,
    AdminSubmissionsResponse,
    HackathonDetail } from '@/lib/types/hackathon';

const TEXT_DIM = '#666666';
interface Props {
    hackathon: HackathonDetail;
    initial: AdminSubmissionsResponse;
    /** null when the viewer is logged in via admin code only (no GitHub session). */
    userId: string | null;
}

function downloadCsv(rows: AdminSubmission[], slug: string) {
    const headers = [
        'rank',
        'submitter',
        'team_members',
        'github_url',
        'repo_score',
        'repo_tier',
        'audit_status',
        'matched_sponsors',
        'deep_analysis_seconds',
        'submitted_at',
    ];
    const escape = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    };
    const lines = [headers.join(',')];
    rows.forEach((row, i) => {
        const sponsorStr = Object.entries(row.matched_sponsors ?? {})
            .map(([n, c]) => (c > 1 ? `${n}×${c}` : n))
            .join('; ');
        lines.push(
            [
                i + 1,
                row.submitter_username,
                (row.team_members ?? []).join('|'),
                row.github_url,
                row.repo_score ?? '',
                row.repo_tier ?? '',
                row.audit_status,
                sponsorStr,
                row.deep_analysis_seconds ?? '',
                row.submitted_at,
            ]
                .map(escape)
                .join(','),
        );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-submissions.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export function AdminDashboardClient({ hackathon, initial, userId }: Props) {
    const router = useRouter();
    const [filter, setFilter] = useState<FilterState>({
        status: 'all',
        sort: 'score_desc',
        search: '' });
    const [publishing, setPublishing] = useState(false);
    const [confirmPublish, setConfirmPublish] = useState(false);
    const [published, setPublished] = useState(hackathon.is_published);
    const [error, setError] = useState<string | null>(null);

    const filtered = useMemo(() => {
        let rows = initial.submissions.slice();
        if (filter.status !== 'all') {
            rows = rows.filter((r) => r.audit_status === filter.status);
        }
        if (filter.search.trim()) {
            const q = filter.search.trim().toLowerCase();
            rows = rows.filter(
                (r) =>
                    r.submitter_username.toLowerCase().includes(q) ||
                    (r.team_members ?? [])
                        .some((t) => t.toLowerCase().includes(q)),
            );
        }
        if (filter.sort === 'score_desc') {
            rows.sort((a, b) => (b.repo_score ?? -1) - (a.repo_score ?? -1));
        } else {
            rows.sort(
                (a, b) =>
                    new Date(b.submitted_at).getTime() -
                    new Date(a.submitted_at).getTime(),
            );
        }
        return rows;
    }, [initial.submissions, filter]);

    const handlePublish = async () => {
        setPublishing(true);
        setError(null);
        try {
            // Hit the Next.js proxy, which adds X-User-Id from the session
            // before forwarding to FastAPI.
            void userId; // referenced for prop completeness; proxy reads its own session
            const res = await fetch(
                `/api/hackathons/${hackathon.slug}/publish`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' } },
            );
            if (!res.ok && res.status !== 409) {
                const body = await res.text();
                throw new Error(body || `HTTP ${res.status}`);
            }
            setPublished(true);
            setConfirmPublish(false);
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Publish failed');
        } finally {
            setPublishing(false);
        }
    };

    const dateRange = `${new Date(hackathon.starts_at).toISOString().slice(0, 10)} → ${new Date(hackathon.ends_at).toISOString().slice(0, 10)}`;

    return (
        <main className="container mx-auto px-4 py-10 max-w-6xl">
            {/* Header */}
            <header className="mb-8">
                <div
                    className="font-mono"
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        color: TEXT_DIM,
                        textTransform: 'uppercase',
                        marginBottom: 10,
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap' }}
                >
                    <span>ADMIN</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>{hackathon.your_role?.toUpperCase() ?? 'VIEWER'}</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>{dateRange}</span>
                </div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 16,
                        flexWrap: 'wrap' }}
                >
                    <div style={{ display: 'flex', alignItems: 'stretch', gap: 14 }}>
                        <div
                            style={{
                                width: 2,
                                background: '#EDEDED',
                                flexShrink: 0 }}
                        />
                        <div>
                            <h1
                                className="font-mono"
                                style={{
                                    fontSize: 26,
                                    fontWeight: 500,
                                    letterSpacing: '0.02em',
                                    textTransform: 'uppercase',
                                    color: '#EDEDED' }}
                            >
                                {hackathon.name}
                            </h1>
                            <div
                                className="font-mono text-muted-foreground"
                                style={{
                                    fontSize: 11,
                                    letterSpacing: '0.04em',
                                    marginTop: 4 }}
                            >
                                {hackathon.slug}
                            </div>
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadCsv(filtered, hackathon.slug)}
                            disabled={filtered.length === 0}
                        >
                            Export CSV
                        </Button>
                        <Link href={`/hackathons/${hackathon.slug}/admin/team`}>
                            <Button variant="outline" size="sm">
                                Team
                            </Button>
                        </Link>
                        <Link href={`/hackathons/${hackathon.slug}/admin/sponsors`}>
                            <Button variant="outline" size="sm">
                                Sponsors
                            </Button>
                        </Link>
                        <Link href={`/hackathons/${hackathon.slug}/admin/awards`}>
                            <Button variant="outline" size="sm">
                                Awards
                            </Button>
                        </Link>
                        <Link href={`/hackathons/${hackathon.slug}/admin/judges`}>
                            <Button variant="outline" size="sm">
                                Judges scores
                            </Button>
                        </Link>
                        {hackathon.your_role === 'organizer' && (
                            <Button
                                size="sm"
                                onClick={() => setConfirmPublish(true)}
                                disabled={published}
                            >
                                {published ? 'Published' : 'Publish leaderboard'}
                            </Button>
                        )}
                    </div>
                </div>

                {/* Developer-join info */}
                {hackathon.access_code && (
                    <DeveloperJoinStrip
                        slug={hackathon.slug}
                        accessCode={hackathon.access_code}
                    />
                )}

                {/* Counts strip */}
                <div
                    className="font-mono"
                    style={{
                        marginTop: 18,
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                        gap: 12 }}
                >
                    {[
                        { label: 'TOTAL', value: initial.total_count, color: '#EDEDED' },
                        {
                            label: 'COMPLETE',
                            value: initial.complete_count,
                            color: '#00FF41' },
                        {
                            label: 'RUNNING',
                            value: initial.running_count,
                            color: '#F59E0B' },
                        {
                            label: 'FAILED',
                            value: initial.failed_count,
                            color: '#EF4444' },
                    ].map((m) => (
                        <div
                            key={m.label}
                            style={{
                                padding: '14px 16px',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px solid rgba(255,255,255,0.06)' }}
                        >
                            <div
                                style={{
                                    fontSize: 10,
                                    color: TEXT_DIM,
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                    marginBottom: 6 }}
                            >
                                {m.label}
                            </div>
                            <div
                                style={{
                                    fontSize: 24,
                                    color: m.color,
                                    fontVariantNumeric: 'tabular-nums',
                                    letterSpacing: '-0.02em',
                                    fontWeight: 500 }}
                            >
                                {m.value}
                            </div>
                        </div>
                    ))}
                </div>
            </header>

            {/* Filter bar */}
            <AdminFilterBar
                value={filter}
                onChange={setFilter}
                counts={{
                    total: initial.total_count,
                    complete: initial.complete_count,
                    running: initial.running_count,
                    failed: initial.failed_count }}
            />

            {/* Table */}
            <div
                style={{
                    border: '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(255,255,255,0.01)' }}
            >
                <SubmissionRowHeader />
                {filtered.length === 0 ? (
                    <div
                        className="font-mono"
                        style={{
                            padding: '48px 24px',
                            textAlign: 'center',
                            color: TEXT_DIM,
                            fontSize: 12,
                            letterSpacing: '0.04em' }}
                    >
                        // no submissions match these filters
                    </div>
                ) : (
                    filtered.map((s, i) => (
                        <SubmissionRow
                            key={s.submission_id}
                            rank={i + 1}
                            submission={s}
                            slug={hackathon.slug}
                        />
                    ))
                )}
            </div>

            {error && (
                <div
                    className="font-mono"
                    style={{
                        marginTop: 16,
                        padding: '12px 16px',
                        border: '1px solid rgba(239,68,68,0.3)',
                        background: 'rgba(239,68,68,0.06)',
                        color: '#fca5a5',
                        fontSize: 12 }}
                >
                    // {error}
                </div>
            )}

            {/* Publish confirm dialog */}
            {confirmPublish && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.6)',
                        zIndex: 50,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 16 }}
                    onClick={() => !publishing && setConfirmPublish(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="relative"
                        style={{
                            maxWidth: 480,
                            width: '100%',
                            background: '#0A0A0A',
                            border: '1px solid rgba(255,255,255,0.10)',
                            padding: '28px 28px' }}
                    >
                        <div
                            className="font-mono"
                            style={{
                                fontSize: 10,
                                color: TEXT_DIM,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                marginBottom: 8 }}
                        >
                            CONFIRM · PUBLISH
                        </div>
                        <h3 className="text-lg font-medium mb-2">
                            Publish the public leaderboard?
                        </h3>
                        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                            This makes the rankings publicly visible at{' '}
                            <span className="font-mono text-xs">
                                /hackathons/{hackathon.slug}/leaderboard
                            </span>
                            . You can&apos;t un-publish without contacting support.
                        </p>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmPublish(false)}
                                disabled={publishing}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handlePublish}
                                disabled={publishing}
                            >
                                {publishing ? 'Publishing…' : 'Publish'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}


function DeveloperJoinStrip({
    slug,
    accessCode,
}: {
    slug: string;
    accessCode: string;
}) {
    const [copiedField, setCopiedField] = useState<'url' | 'code' | null>(null);
    const joinUrl =
        typeof window !== 'undefined'
            ? `${window.location.origin}/hackathons/${slug}/join`
            : `/hackathons/${slug}/join`;

    const copy = (value: string, which: 'url' | 'code') => {
        navigator.clipboard.writeText(value).then(
            () => {
                setCopiedField(which);
                setTimeout(() => setCopiedField(null), 1500);
            },
            () => {
                /* ignore */
            },
        );
    };

    const cellStyle: React.CSSProperties = {
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
    };
    const labelStyle: React.CSSProperties = {
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: TEXT_DIM,
    };
    const valueRow: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
    };
    const valueStyle: React.CSSProperties = {
        fontSize: 13,
        color: '#EDEDED',
        background: 'rgba(0,0,0,0.25)',
        padding: '6px 10px',
        border: '1px solid rgba(255,255,255,0.08)',
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    };
    const copyBtnStyle: React.CSSProperties = {
        fontSize: 11,
        padding: '6px 12px',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        color: '#EDEDED',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
    };

    return (
        <div
            className="font-mono"
            style={{
                marginTop: 18,
                padding: '14px 16px',
                background: 'rgba(204,120,92,0.04)',
                border: '1px solid rgba(204,120,92,0.30)',
                display: 'flex',
                gap: 18,
                flexWrap: 'wrap',
                alignItems: 'center',
            }}
        >
            <div style={cellStyle}>
                <div style={labelStyle}>Developer join URL</div>
                <div style={valueRow}>
                    <code style={valueStyle}>{joinUrl}</code>
                    <button
                        type="button"
                        onClick={() => copy(joinUrl, 'url')}
                        style={copyBtnStyle}
                    >
                        {copiedField === 'url' ? '✓ Copied' : 'Copy'}
                    </button>
                </div>
            </div>
            <div style={{ ...cellStyle, flex: '0 0 auto', minWidth: 180 }}>
                <div style={labelStyle}>Join code</div>
                <div style={valueRow}>
                    <code
                        style={{
                            ...valueStyle,
                            letterSpacing: '0.18em',
                            fontSize: 16,
                            color: '#CC785C',
                            textAlign: 'center',
                            fontWeight: 500,
                        }}
                    >
                        {accessCode}
                    </code>
                    <button
                        type="button"
                        onClick={() => copy(accessCode, 'code')}
                        style={copyBtnStyle}
                    >
                        {copiedField === 'code' ? '✓ Copied' : 'Copy'}
                    </button>
                </div>
            </div>
        </div>
    );
}
