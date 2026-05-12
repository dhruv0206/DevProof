/**
 * Hackathon types — mirrors the contracts at
 * `ai-engine/docs/HACKATHON_API_CONTRACTS.md`. Frontend consumes endpoints
 * #1 (create), #7 (admin submissions), #8 (publish), #9 (leaderboard) plus
 * #2 (fetch event) for role gating.
 */

import type { RepoTierV4 } from './v4-output';

export type HackathonRole = 'organizer' | 'judge' | 'participant';
export type AuditStatus = 'pending' | 'running' | 'complete' | 'failed';
export type SubmissionStatus = 'draft' | 'submitted' | 'withdrawn';

export interface HackathonSponsor {
    name: string;
    /** Hidden on public endpoints — only present for organizers/judges. */
    packages?: string[];
    prize?: string;
}

export interface HackathonExtras {
    deployed_url?: string;
    demo_video_url?: string;
    description?: string;
    slide_deck_url?: string;
    tech_stack_tags?: string[];
    [k: string]: unknown;
}

/** Endpoint #2 — `GET /api/hackathons/{slug}` */
export interface HackathonDetail {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    starts_at: string;
    submissions_close_at: string;
    judging_starts_at: string;
    ends_at: string;
    is_published: boolean;
    sponsors: HackathonSponsor[];
    rules_text: string | null;
    submission_count: number;
    your_role: HackathonRole | null;
    your_submission_id: string | null;
}

/** A row in the organizer admin table (endpoint #7). */
export interface AdminSubmission {
    submission_id: string;
    github_url: string;
    submitter_username: string;
    team_members: string[];
    submission_status: SubmissionStatus;
    audit_status: AuditStatus;
    repo_score: number | null;
    repo_tier: RepoTierV4 | null;
    matched_sponsors: Record<string, number>;
    extras: HackathonExtras;
    submitted_at: string;
    deep_analysis_seconds: number | null;
    audit_error?: string | null;
    /** True iff this submission is pinned to the dev's public profile. */
    pinned_to_profile?: boolean;
}

/**
 * Endpoint #1c — `GET /api/hackathons/mine` row.
 * Drives the dev-side `/hackathons` dashboard tab.
 */
export interface MyHackathonEvent {
    hackathon: {
        id: string;
        slug: string;
        name: string;
        starts_at: string | null;
        submissions_close_at: string | null;
        ends_at: string | null;
        is_published: boolean;
    };
    your_role: HackathonRole;
    ended: boolean;
    submission: MySubmission | null;
}

/** Endpoint #6 detail returned with score visibility flag. */
export interface MySubmission {
    submission_id: string;
    github_url: string;
    extras: HackathonExtras;
    team_members: string[];
    submission_status: SubmissionStatus;
    audit_status: AuditStatus;
    audit_error: string | null;
    repo_score: number | null;
    repo_tier: RepoTierV4 | null;
    matched_sponsors: Record<string, number>;
    /** True iff the score number itself is visible to this caller. */
    score_visible: boolean;
    /** Reason the score is hidden (`leaderboard_not_published`) or null. */
    score_hidden_reason: string | null;
    v4_output_url: string | null;
    submitted_at: string;
    deep_analysis_seconds: number | null;
    pinned_to_profile: boolean;
}

/** Endpoint #1d — public pinned hackathons for `@{username}`. */
export interface PinnedHackathonItem {
    hackathon: {
        id: string;
        slug: string;
        name: string;
        starts_at: string | null;
        ends_at: string | null;
        is_published: boolean;
        sponsors: { name: string; prize?: string | null }[];
    };
    submission: MySubmission;
}

/** Endpoint #7 response. */
export interface AdminSubmissionsResponse {
    hackathon_id: string;
    submissions: AdminSubmission[];
    total_count: number;
    complete_count: number;
    running_count: number;
    failed_count: number;
}

/**
 * Public-list shape for `GET /api/hackathons` (browse-all).
 *
 * NOT in the contracts doc — Track A may not implement this for MVP.
 * The browse page (`/hackathons`) gracefully falls back to "no events
 * live yet" when the endpoint returns 404 / fails.
 */
export interface HackathonListItem {
    slug: string;
    name: string;
    starts_at: string;
    ends_at: string;
    submissions_close_at: string;
    is_published: boolean;
    submission_count: number;
    /** Public-only sponsor view (no `packages`). */
    sponsors: { name: string; prize?: string }[];
}

export interface HackathonListResponse {
    hackathons: HackathonListItem[];
}

/** Endpoint #9 — public leaderboard. */
export interface LeaderboardRanking {
    rank: number;
    submission_id: string;
    submitter_username: string;
    team_members: string[];
    github_url: string;
    repo_score: number;
    repo_tier: RepoTierV4 | null;
    matched_sponsors: Record<string, number>;
}

export interface LeaderboardResponse {
    hackathon_id: string;
    name: string;
    published_at: string;
    rankings: LeaderboardRanking[];
    sponsor_leaderboards: Record<
        string,
        { rank: number; submission_id: string; repo_score: number }[]
    >;
}
