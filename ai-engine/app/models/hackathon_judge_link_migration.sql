-- Adds shareable judge-link support: one URL per hackathon that any judge can
-- click without auth, type their name, and score submissions. Designed so
-- judges who aren't DevProof users (sponsors, community folks) can score
-- without going through OAuth or magic-link onboarding.
--
-- Threat model: the token IS the credential. Organizers share the link out-
-- of-band (Slack, email). If it leaks, the organizer regenerates and the old
-- token immediately becomes invalid.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Add judge_link_token to hackathon (nullable; only set when the
--    organizer clicks "Generate judge link").
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE hackathon
    ADD COLUMN IF NOT EXISTS judge_link_token TEXT;

-- Partial unique index — multiple NULLs are fine, but two hackathons can't
-- collide on the same token (and the token is what gates access to the
-- whole judge surface).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hackathon_judge_link_token
    ON hackathon(judge_link_token)
    WHERE judge_link_token IS NOT NULL;


-- ──────────────────────────────────────────────────────────────────────────
-- 2. hackathon_judge_score: one row per (submission, judge_name) pair.
--    judge_name is plain text the judge typed in — no auth required for
--    this MVP. UNIQUE constraint means a judge editing their existing entry
--    upserts in place (matched by name + submission) rather than creating
--    duplicates.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hackathon_judge_score (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hackathon_id    UUID NOT NULL REFERENCES hackathon(id) ON DELETE CASCADE,
    submission_id   UUID NOT NULL REFERENCES hackathon_submission(id) ON DELETE CASCADE,

    -- Judge identity for this row. Free-text — no auth. Trimmed + length-
    -- capped at the app layer.
    judge_name      TEXT NOT NULL,

    -- 0-10 with optional decimal. Nullable so a judge can leave notes
    -- without scoring (or score without notes).
    score           NUMERIC(4, 1),

    notes           TEXT,

    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- One row per judge per submission. Editing reuses the same row.
    -- Case-insensitive uniqueness: "Alice" and "alice" are the same judge.
    CONSTRAINT uq_judge_score_submission_judge
        UNIQUE (submission_id, judge_name)
);

CREATE INDEX IF NOT EXISTS ix_judge_score_submission
    ON hackathon_judge_score(submission_id);
CREATE INDEX IF NOT EXISTS ix_judge_score_hackathon
    ON hackathon_judge_score(hackathon_id);
