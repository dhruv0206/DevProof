-- =============================================================================
-- Add organizer_access_code to hackathon — code-based admin login for non-dev
-- organizers. Run after hackathon_migration.sql.
-- =============================================================================

ALTER TABLE hackathon
    ADD COLUMN IF NOT EXISTS organizer_access_code VARCHAR(64) UNIQUE;

-- Backfill any existing rows with a random 32-char code.
UPDATE hackathon
SET organizer_access_code = encode(gen_random_bytes(24), 'base64')
WHERE organizer_access_code IS NULL;
