/**
 * Developer vs. organizer session discriminator.
 *
 * DevProof has two personas sharing one BetterAuth session:
 *   • Developers   — sign in via GitHub OAuth, have a row in `account` with
 *                    providerId='github'. They USE DevProof's audit/portfolio
 *                    features.
 *   • Organizers   — sign in only via hackathon magic-link, never link a
 *                    GitHub identity. They MANAGE hackathon events; the
 *                    developer-side pages (dashboard, profile, issues) have
 *                    no meaning for them.
 *
 * The discriminator is: does the user have a GitHub account linked in the
 * `account` table? If yes → developer. If no → organizer-only.
 *
 * An organizer can become a developer by linking their GitHub account
 * (the existing settings flow handles that); after that, this function
 * starts returning true. There's no "either/or" — the data model allows a
 * single user to be both.
 */

import { pool } from '@/lib/db';

export interface MinimalSessionUser {
    id: string;
}

/**
 * Returns true iff the user has a linked GitHub OAuth account, indicating
 * they're a developer (not just an organizer with a magic-link session).
 *
 * Cheap query, indexed lookup on (userId, providerId). Safe to call inline
 * on server-rendered pages.
 */
export async function userHasGithubLink(userId: string): Promise<boolean> {
    const res = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
            SELECT 1 FROM account
            WHERE "userId" = $1 AND "providerId" = 'github'
        ) AS exists`,
        [userId],
    );
    return res.rows[0]?.exists === true;
}

/**
 * Convenience: returns true iff the session corresponds to a developer.
 * Null/undefined session → false.
 */
export async function isDeveloperSession(
    session: { user?: MinimalSessionUser | null } | null | undefined,
): Promise<boolean> {
    if (!session?.user?.id) return false;
    return userHasGithubLink(session.user.id);
}
