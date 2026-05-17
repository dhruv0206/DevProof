-- Hackathon team submissions + edit-lock + richer fields (2026-05-17).
--
-- Three independent additions, all backwards-compatible:
--
--   1. hackathon.submissions_locked_override — organizer-controlled manual
--      lock toggle. Combined with the existing submissions_close_at gives
--      organizers both scheduled and instant control over edit windows.
--
--   2. New first-class submission fields:
--        tagline           one-line pitch shown on leaderboards
--        what_it_does      paragraph for judge context
--        demo_url          live deployed app (distinct from video_url)
--        team_name         display name for teams (null for solo)
--        tracks_opted_out_json  sponsor names the team chose NOT to compete for
--      These were previously inferred from extras_json — promoting to columns
--      gives validation + indexability + cleaner code paths.
--
--   3. hackathon_team_member — invite-based teammate model. Mirrors
--      hackathon_invite for organizer invites; gives accepted teammates
--      full edit rights on the submission and surfaces the hackathon on
--      their personal /me/hackathons dashboard. Replaces the old free-text
--      team_members_json (which stays for backwards display compat).
--
-- Re-runnable: every statement uses IF NOT EXISTS / DROP-IF-EXISTS guards.


-- ──────────────────────────────────────────────────────────────────────────
-- 1. Organizer-controlled lock toggle
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE hackathon
    ADD COLUMN IF NOT EXISTS submissions_locked_override BOOLEAN NOT NULL DEFAULT FALSE;


-- ──────────────────────────────────────────────────────────────────────────
-- 2. Promoted submission fields
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE hackathon_submission
    ADD COLUMN IF NOT EXISTS tagline      VARCHAR(140);
ALTER TABLE hackathon_submission
    ADD COLUMN IF NOT EXISTS what_it_does VARCHAR(500);
ALTER TABLE hackathon_submission
    ADD COLUMN IF NOT EXISTS demo_url     VARCHAR(500);
ALTER TABLE hackathon_submission
    ADD COLUMN IF NOT EXISTS team_name    VARCHAR(80);
ALTER TABLE hackathon_submission
    ADD COLUMN IF NOT EXISTS tracks_opted_out_json JSONB NOT NULL DEFAULT '[]'::jsonb;


-- ──────────────────────────────────────────────────────────────────────────
-- 3. hackathon_team_member
--
-- One row per invitation (regardless of identifier type — username OR email).
-- Either invited_user_id OR invited_email must be set (CHECK constraint).
-- Status transitions: pending -> accepted | declined | revoked. Expiry is
-- enforced at the application layer (read-side comparison against expires_at).
--
-- accepted_user_id is set on accept and is the FK we join on for the
-- /me/hackathons dashboard query — denormalized from invited_user_id because
-- an email-based invite has no user_id at invite time.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hackathon_team_member (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id     UUID NOT NULL REFERENCES hackathon_submission(id) ON DELETE CASCADE,

    -- Identifier for the invitee. Exactly one is set at insert time.
    invited_user_id   TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    invited_email     TEXT,

    -- Set when the invite is accepted. May be the same as invited_user_id
    -- (username invite) or freshly resolved on first login (email invite).
    accepted_user_id  TEXT REFERENCES "user"(id) ON DELETE SET NULL,

    -- Magic-link credential. Single-use; cleared/marked on accept or decline.
    invite_token      TEXT NOT NULL UNIQUE,

    -- Lifecycle. pending -> accepted | declined | revoked.
    status            VARCHAR(16) NOT NULL DEFAULT 'pending',

    invited_by        TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    invited_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    accepted_at       TIMESTAMP WITH TIME ZONE,
    declined_at       TIMESTAMP WITH TIME ZONE,
    revoked_at        TIMESTAMP WITH TIME ZONE,
    expires_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),

    CONSTRAINT chk_team_member_target CHECK (
        invited_user_id IS NOT NULL OR invited_email IS NOT NULL
    ),
    CONSTRAINT chk_team_member_status CHECK (
        status IN ('pending', 'accepted', 'declined', 'revoked')
    )
);

CREATE INDEX IF NOT EXISTS ix_team_member_submission
    ON hackathon_team_member(submission_id);
CREATE INDEX IF NOT EXISTS ix_team_member_accepted_user
    ON hackathon_team_member(accepted_user_id)
    WHERE accepted_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_team_member_token
    ON hackathon_team_member(invite_token);
CREATE INDEX IF NOT EXISTS ix_team_member_invited_user
    ON hackathon_team_member(invited_user_id)
    WHERE invited_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_team_member_invited_email
    ON hackathon_team_member(invited_email)
    WHERE invited_email IS NOT NULL;
