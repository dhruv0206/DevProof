-- =============================================================================
-- Add pinned_to_profile flag to hackathon_submission. Lets a dev pin a
-- completed hackathon result to their public DevProof profile. Run after
-- hackathon_admin_code_migration.sql.
-- =============================================================================

ALTER TABLE hackathon_submission
    ADD COLUMN IF NOT EXISTS pinned_to_profile BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ix_hackathon_submission_pinned
    ON hackathon_submission(submitter_user_id)
    WHERE pinned_to_profile = TRUE;
