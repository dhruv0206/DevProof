-- =============================================================================
-- hackathon_invite table — magic-link invitations for adding admins/judges/
-- observers to a hackathon without sharing raw organizer_access_code.
--
-- Flow:
--   1. Existing organizer calls POST /api/hackathons/{slug}/invites with
--      {invited_email, role}. Backend creates an invite row with a fresh
--      32-char base64 token.
--   2. Organizer copies the magic link URL containing the token and sends
--      it to the invitee (email/Slack/whatever).
--   3. Invitee clicks the link, lands on /hackathons/{slug}/invites/{token}.
--      If logged in to DevProof, they accept → backend creates a hackathon_role
--      row and marks the invite as used.
--   4. If not logged in, login redirect preserves invite context.
--
-- All token-based access is single-use (used_at set on accept) and bounded
-- by expires_at (default 7 days). Revocation is supported via revoked_at.
-- =============================================================================

CREATE TABLE IF NOT EXISTS hackathon_invite (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hackathon_id    UUID NOT NULL REFERENCES hackathon(id) ON DELETE CASCADE,
    invited_email   TEXT,                                  -- optional; null = "anyone with link"
    invited_by      TEXT NOT NULL REFERENCES "user"(id),   -- who created the invite
    role            VARCHAR(32) NOT NULL,                  -- organizer | judge | observer
    token           TEXT NOT NULL UNIQUE,                  -- 32-char base64
    expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,     -- typically created_at + 7d
    used_at         TIMESTAMP WITH TIME ZONE,              -- single-use marker
    accepted_by     TEXT REFERENCES "user"(id),            -- who actually accepted
    revoked_at      TIMESTAMP WITH TIME ZONE,              -- soft revocation
    revoked_by      TEXT REFERENCES "user"(id),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_hackathon_invite_token       ON hackathon_invite(token);
CREATE INDEX IF NOT EXISTS ix_hackathon_invite_hackathon   ON hackathon_invite(hackathon_id);
CREATE INDEX IF NOT EXISTS ix_hackathon_invite_email
    ON hackathon_invite(invited_email)
    WHERE invited_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_hackathon_invite_active
    ON hackathon_invite(hackathon_id, expires_at)
    WHERE used_at IS NULL AND revoked_at IS NULL;
