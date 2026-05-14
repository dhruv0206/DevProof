# Hackathon Multi-Admin + Magic Links — Design

**Status:** Approved 2026-05-14
**Author:** Dhruv + Claude
**Context:** Existing hackathon platform uses single `organizer_access_code` per hackathon (code = password, shared via copy/paste). Need scalable multi-admin model with proper invite UX before Elsa demo and broader rollout.

## Goals

1. **Multi-admin per hackathon** — multiple people can manage one event with distinct identities
2. **Multi-hackathon per user** — one DevProof user can have roles across many events
3. **Magic-link invites** — one-time URL tokens, not raw codes shared via Slack/email
4. **Audit trail** — who invited whom, when accepted, when revoked
5. **Backwards compatible** — existing 2 test hackathons keep working unchanged

## Non-goals (this iteration)

- Org-level accounts (FOMO Club as an entity with many events) — defer
- Bulk invite (paste 50 emails) — defer
- Email delivery (we display the link for copy-paste; org sends manually for now)
- SSO / SAML for enterprise organizers
- API keys / programmatic access

## Role Model

Extend existing `hackathon_role` table. Five roles:

| Role | Permissions | Limits |
|---|---|---|
| `OWNER` | Full control. Invite/remove all roles. Delete event. | 1-3 per hackathon |
| `ADMIN` | Full event management. Cannot delete event or change other OWNERs/ADMINs. | Unlimited |
| `JUDGE` | Score submissions, view leaderboard. Cannot edit settings or invite. | Unlimited |
| `OBSERVER` | Read-only. Used for sponsors who want visibility only. | Unlimited |
| `PARTICIPANT` | Submit projects. (Already exists.) | Unlimited |

Every admin action checks `hackathon_role` for the current logged-in user. Codes (legacy `organizer_access_code`) only exist as invite tokens or backwards-compat fallback.

## Schema Changes (Additive Only)

### New table: `hackathon_invite`

```sql
CREATE TABLE hackathon_invite (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hackathon_id    UUID NOT NULL REFERENCES hackathon(id) ON DELETE CASCADE,
    invited_email   TEXT,                                    -- optional; null = "anyone with link"
    invited_by      TEXT NOT NULL,                           -- user_id who created the invite
    role            VARCHAR(32) NOT NULL,                    -- OWNER | ADMIN | JUDGE | OBSERVER
    token           TEXT NOT NULL UNIQUE,                    -- 32-char base64, primary lookup key
    expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,       -- default = created_at + 7 days
    used_at         TIMESTAMP WITH TIME ZONE,                -- when token was redeemed
    accepted_by     TEXT,                                    -- user_id of who actually accepted
    revoked_at      TIMESTAMP WITH TIME ZONE,                -- soft-revoke
    revoked_by      TEXT,                                    -- who revoked
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_hackathon_invite_token ON hackathon_invite(token);
CREATE INDEX ix_hackathon_invite_hackathon ON hackathon_invite(hackathon_id);
CREATE INDEX ix_hackathon_invite_email ON hackathon_invite(invited_email) WHERE invited_email IS NOT NULL;
```

### No changes to existing tables

- `hackathon_role` already has the schema we need (id, hackathon_id, user_id, role, created_at)
- `hackathon.organizer_access_code` stays (backwards compat for existing hackathons)

## URL & Auth Flow

### Magic link URL

```
https://orenda.vision/hackathons/<slug>/invites/<token>
```

### Click flow

1. User clicks link
2. Frontend validates token via `GET /api/hackathons/<slug>/invites/<token>` — returns invite metadata or error
3. If **user is logged in to DevProof**:
   - `POST /api/hackathons/<slug>/invites/<token>/accept` → backend creates `hackathon_role` row, marks invite as used
   - Redirect to `/hackathons/<slug>/admin` (or `/judge` if role is JUDGE)
4. If **user is NOT logged in**:
   - Land on login page with `?return_to=/hackathons/<slug>/invites/<token>`
   - After login, auto-redirect back; system auto-accepts
5. Auth source-of-truth: **the DevProof session cookie set by BetterAuth**. The role-check middleware reads session.user_id and queries `hackathon_role`.

### Authorization middleware

```
require_role(slug, *roles_allowed) →
  - session.user_id  (from BetterAuth cookie)
  - SELECT 1 FROM hackathon_role
    WHERE hackathon_id = (SELECT id FROM hackathon WHERE slug=$1)
      AND user_id = $session_user_id
      AND role = ANY($roles_allowed)
  - On miss: 403
  - On miss + legacy `hk_admin_{slug}` cookie present AND code matches: allow + log "legacy auth used"
```

The legacy fallback lets old hackathons keep working without re-issuing invites.

## API Endpoints (new)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/hackathons/<slug>/invites` | OWNER/ADMIN | Create invite (returns token + magic-link URL) |
| `GET` | `/api/hackathons/<slug>/invites` | OWNER/ADMIN | List invites (pending, accepted, revoked) |
| `DELETE` | `/api/hackathons/<slug>/invites/<id>` | OWNER/ADMIN | Revoke invite |
| `GET` | `/api/hackathons/<slug>/invites/<token>` | Public | Look up invite by token (returns hackathon info + role to display) |
| `POST` | `/api/hackathons/<slug>/invites/<token>/accept` | Authenticated user | Accept invite — create hackathon_role row |
| `GET` | `/api/hackathons/<slug>/team` | OWNER/ADMIN/JUDGE | List current team members |
| `DELETE` | `/api/hackathons/<slug>/team/<user_id>` | OWNER (or ADMIN for non-OWNERs) | Remove team member |
| `PATCH` | `/api/hackathons/<slug>/team/<user_id>` | OWNER | Change member role |
| `GET` | `/api/hackathons/mine?role=admin` | Authenticated user | List hackathons where current user has ADMIN/OWNER |

## Frontend Pages (new)

| Path | Purpose |
|---|---|
| `/hackathons/<slug>/admin/team` | Team management: see members, invite new, revoke pending invites, change roles |
| `/hackathons/<slug>/invites/<token>` | Invite landing — "You've been invited to manage X as ROLE. Accept?" |
| `/hackathons/admin` | Dashboard listing all hackathons where current user is admin/owner |

## Backwards Compatibility

| Scenario | Behavior |
|---|---|
| Existing 2 hackathons with `organizer_access_code` | Old `/admin/login` flow still works. Cookie auth via code persists. |
| New hackathons (created after this ships) | No `organizer_access_code` generated. Creator is auto-OWNER via `hackathon_role`. |
| Logged-in user with hackathon_role + legacy cookie | Role-based auth takes precedence. |
| User pastes a code for a NEW hackathon | Returns 403 "code login not enabled for this event — sign in to DevProof and use the invite link". |

## Migration Path

1. Apply schema migration (creates `hackathon_invite` table). Idempotent — `CREATE IF NOT EXISTS`.
2. Backfill: existing 2 hackathons stay on legacy code auth. No data migration required.
3. Deploy backend with new endpoints. Old endpoints still work.
4. Deploy frontend with new pages. Old `/admin/login` still rendered.
5. New hackathon creation flow auto-creates `hackathon_role` row with OWNER for the creator.
6. (Future) deprecate `organizer_access_code` once all live hackathons have migrated to role-based auth.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| New role-check middleware locks out admins | Legacy code fallback preserves existing access; deploy behind feature flag if needed |
| Token leak | 7-day expiry, single-use (`used_at` set on accept), revocable, audit trail |
| Token brute-force | 32-char base64 = 192 bits entropy; rate-limit `/invites/<token>` endpoint |
| Migration applied in dev but not prod | Backend startup auto-applies pending migrations |
| Schema rollback needed | All changes are additive — `DROP TABLE hackathon_invite` reverts cleanly |

## Out of Scope (Future Work)

- Email delivery of magic links (currently: organizer copies and sends manually)
- Org-level accounts (FOMO Club as entity with many events)
- Bulk invite UI (paste many emails)
- Role-specific dashboards (JUDGE sees only judging, OBSERVER sees only leaderboard)
- API keys for programmatic access
- Audit log UI (data is captured in `hackathon_invite` but no admin viewer yet)

## Acceptance Criteria

- [ ] OWNER of new hackathon can invite another user as ADMIN via magic link
- [ ] Invited user (logged in) clicks link → lands in admin dashboard
- [ ] Invited user (logged out) clicks link → logs in → lands in admin dashboard
- [ ] OWNER sees list of pending invites and can revoke
- [ ] OWNER sees list of current team members and can remove
- [ ] User with hackathon_role on multiple hackathons sees them all at `/hackathons/admin`
- [ ] Existing 2 test hackathons with code-based auth keep working unchanged
- [ ] Token-based invites are single-use (second click on same link = error)
- [ ] Expired tokens (>7 days old) return error on accept
- [ ] Revoked tokens return error on accept

## Implementation Order

1. Schema migration + model classes
2. Backend endpoints (invite CRUD, accept, team management)
3. Auth middleware updates
4. Frontend team management page
5. Frontend invite landing page + accept flow
6. Frontend "/hackathons/admin" multi-hackathon dashboard
7. End-to-end test (create hackathon → invite ADMIN → accept → verify access)
8. Deploy to dev, validate
9. Deploy to prod (Cloud Run env, Vercel)

---

*Approved by Dhruv on 2026-05-14 after iterative discussion. Implementation plan to follow via writing-plans skill.*
