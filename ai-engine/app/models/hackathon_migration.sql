-- =============================================================================
-- Hackathon platform tables — run this in Supabase SQL Editor
-- =============================================================================
-- Three new tables: hackathon, hackathon_role, hackathon_submission.
-- See app/models/hackathon.py for the SQLAlchemy mirror.
-- After running this, restart the backend to pick up the new models.
-- =============================================================================

-- ─── hackathon ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hackathon (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    organizer_user_id TEXT NOT NULL REFERENCES "user"(id),

    starts_at TIMESTAMPTZ,
    submissions_close_at TIMESTAMPTZ,
    judging_starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,

    access_code VARCHAR(32) NOT NULL UNIQUE,

    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    sponsors_json JSONB NOT NULL DEFAULT '[]'::jsonb,

    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_hackathon_slug ON hackathon(slug);
CREATE INDEX IF NOT EXISTS ix_hackathon_organizer ON hackathon(organizer_user_id);


-- ─── hackathon_role ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hackathon_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hackathon_id UUID NOT NULL REFERENCES hackathon(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id),
    role VARCHAR(20) NOT NULL CHECK (role IN ('organizer', 'judge', 'participant')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_hackathon_role_user UNIQUE (hackathon_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_hackathon_role_hackathon ON hackathon_role(hackathon_id);
CREATE INDEX IF NOT EXISTS ix_hackathon_role_user ON hackathon_role(user_id);


-- ─── hackathon_submission ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hackathon_submission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hackathon_id UUID NOT NULL REFERENCES hackathon(id) ON DELETE CASCADE,
    submitter_user_id TEXT NOT NULL REFERENCES "user"(id),
    project_id UUID REFERENCES projects(id),

    github_url TEXT NOT NULL,
    extras_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    team_members_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    matched_sponsors_json JSONB NOT NULL DEFAULT '{}'::jsonb,

    submission_status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (submission_status IN ('draft', 'submitted', 'withdrawn')),
    audit_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (audit_status IN ('pending', 'running', 'complete', 'failed')),
    audit_error TEXT,

    submitted_at TIMESTAMPTZ,
    withdrawn_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_hackathon_submission_per_dev UNIQUE (hackathon_id, submitter_user_id)
);

CREATE INDEX IF NOT EXISTS ix_hackathon_submission_hackathon ON hackathon_submission(hackathon_id);
CREATE INDEX IF NOT EXISTS ix_hackathon_submission_submitter ON hackathon_submission(submitter_user_id);
CREATE INDEX IF NOT EXISTS ix_hackathon_submission_audit_status ON hackathon_submission(audit_status);


-- ─── Sanity check ────────────────────────────────────────────────────────────
SELECT
    (SELECT COUNT(*) FROM hackathon) AS hackathons,
    (SELECT COUNT(*) FROM hackathon_role) AS roles,
    (SELECT COUNT(*) FROM hackathon_submission) AS submissions;
