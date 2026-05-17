# Hackathon Multi-Admin + Magic Links — Design

**Status:** Implemented 2026-05-14 (pending manual QA)
**Author:** Dhruv + Claude

## Context

Existing hackathon platform used a single `organizer_access_code` per event (the code itself was the password, shared via copy/paste). This doesn't scale to:
- Multiple admins per event (e.g., Elsa + her co-organizer)
- One person admin-ing multiple events
- Professional UX for first impressions

## Goals (Shipped This Iteration)

1. **Multi-admin per hackathon** — multiple users can manage one event with distinct identities
2. **Multi-hackathon per user** — one DevProof user can have roles across many events
3. **Magic-link invites** — one-time URL tokens, not raw codes
4. **Audit trail** — who invited whom, when accepted, when revoked
5. **Backwards compatible** — existing 2 test hackathons keep working unchanged
6. **CLI provisioning** — manual organizer onboarding while pre-revenue

## Explicitly Out of Scope (Deferred)

- **SUPER_ADMIN role** — not needed pre-revenue; manual provisioning via CLI works
- **Self-serve "request to host" flow with approval queue** — defer until volume justifies
- **Email delivery automation** — for now, organizer copies magic link and pastes it manually
- **Org-level accounts** (FOMO Club as entity owning many events) — defer
- **Bulk invite UI** — defer
- **SSO / SAML** — defer
- **Email + password auth provider** — we use GitHub OAuth via existing BetterAuth; if a non-dev organizer needs to log in, they sign up via GitHub one-time (acceptable for MVP)

## Role Model

Extended existing `hackathon_role` table. Four roles:

| Role | Permissions |
|---|---|
| `organizer` | Full event admin. Invite/remove team members, change roles, manage settings, publish leaderboard. |
| `judge` | View submissions + leaderboard. Score submissions. Cannot invite or change settings. |
| `observer` | Read-only. Used for sponsors who want visibility but no actions. |
| `participant` | Submit projects. (Already existed.) |

Every admin action checks `hackathon_role` for the current authenticated user. Legacy `organizer_access_code` paste remains as a fallback for the 2 existing test hackathons.

## Schema Changes (Additive Only)

### New table: `hackathon_invite`

```sql
CREATE TABLE hackathon_invite (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hackathon_id    UUID NOT NULL REFERENCES hackathon(id) ON DELETE CASCADE,
    invited_email   TEXT,
    invited_by      TEXT NOT NULL REFERENCES "user"(id),
    role            VARCHAR(32) NOT NULL,
    token           TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at         TIMESTAMP WITH TIME ZONE,
    accepted_by     TEXT REFERENCES "user"(id),
    revoked_at      TIMESTAMP WITH TIME ZONE,
    revoked_by      TEXT REFERENCES "user"(id),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

Migration file: `ai-engine/app/models/hackathon_invite_migration.sql`. Applied to Supabase via MCP on 2026-05-14.

### No changes to existing tables.

## URL & Auth Flow

### Magic link URL pattern

```
https://orenda.vision/hackathons/<slug>/invites/<token>
```

### Click flow

1. User clicks the link → lands on `/hackathons/<slug>/invites/<token>` (Next.js page)
2. Frontend calls `GET /api/hackathons/invites/lookup/<token>` (public, no auth) → returns invite metadata
3. Page renders one of three states:
   - **Invalid/expired/revoked** → terminal error
   - **Not signed in** → "Sign in to accept" CTA (BetterAuth GitHub OAuth) with `callbackUrl` back to the same page
   - **Signed in** → "Accept invite" button
4. On accept, frontend calls Next API proxy `POST /api/hackathons/invites/accept?token=...`
5. Proxy forwards `X-User-Id` header to FastAPI `POST /api/hackathons/invites/accept/<token>`
6. Backend creates (or replaces) `hackathon_role` row, marks invite `used_at`, returns redirect path
7. Frontend redirects to `/hackathons/<slug>/admin` (organizer) or `/hackathons/<slug>` (judge/observer)

### Auth source-of-truth

- DevProof session cookie (BetterAuth, set on GitHub OAuth)
- Backend reads session.user_id from `X-User-Id` header (set by Next.js proxy after resolving cookie)
- Role check queries `hackathon_role` for that user_id + this hackathon
- Legacy fallback: `X-Hackathon-Admin-Code` header from the per-slug cookie still works for backwards compat

## API Endpoints (Shipped)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/hackathons/{slug}/invites` | organizer | Create invite, returns magic link |
| `GET` | `/api/hackathons/{slug}/invites` | organizer | List invites (pending/accepted/expired/revoked) |
| `DELETE` | `/api/hackathons/{slug}/invites/{id}` | organizer | Revoke pending invite |
| `GET` | `/api/hackathons/invites/lookup/{token}` | public | Look up invite metadata for the landing page |
| `POST` | `/api/hackathons/invites/accept/{token}` | authenticated | Accept invite → create role row |
| `GET` | `/api/hackathons/{slug}/team` | organizer/judge/observer | List current team members |
| `PATCH` | `/api/hackathons/{slug}/team/{user_id}` | organizer | Change member role (guards last-organizer) |
| `DELETE` | `/api/hackathons/{slug}/team/{user_id}` | organizer | Remove member (guards last-organizer) |
| `GET` | `/api/hackathons/admin/mine` | authenticated | List hackathons where I'm organizer |

## Frontend Pages (Shipped)

| Path | Purpose |
|---|---|
| `/hackathons/admin` | Multi-hackathon dashboard for organizers |
| `/hackathons/<slug>/admin/team` | Team management — list, invite, revoke, change roles |
| `/hackathons/<slug>/invites/<token>` | Magic-link landing — sign in if needed, then accept |

### Frontend API proxies (Next.js, forward session to FastAPI)

- `POST /api/hackathons/invites/accept?token=...` — accept handler
- `POST /api/hackathons-proxy/<slug>/invites` — create invite
- `DELETE /api/hackathons-proxy/<slug>/invites/<id>` — revoke
- `PATCH /api/hackathons-proxy/<slug>/team/<user_id>` — change role
- `DELETE /api/hackathons-proxy/<slug>/team/<user_id>` — remove

## CLI Tool

`ai-engine/scripts/create_organizer.py` — manual onboarding tool while pre-revenue:

```bash
python scripts/create_organizer.py \
    --email elsa@fomo.club \
    --name "Elsa Bismuth" \
    --hackathon-slug fomo-munich-2026 \
    --hackathon-name "FOMO Munich 2026" \
    --starts-at 2026-06-01 \
    --ends-at 2026-06-03
```

Creates user (if email is new), creates hackathon (if slug is new), assigns ORGANIZER role, generates a magic-link invite, prints the URL ready to copy/paste into an email.

## Backwards Compatibility

| Scenario | Behavior |
|---|---|
| Existing 2 hackathons with `organizer_access_code` | Old `/admin/login` flow still works. Cookie + code-paste auth persists. |
| New hackathons created via CLI | No `organizer_access_code` generated. Creator is auto-assigned `organizer` role via `hackathon_role`. |
| Logged-in user with hackathon_role + legacy cookie | Role-based auth takes precedence. Cookie ignored. |
| Code paste from legacy cookie | Still grants admin access. Will be deprecated eventually. |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| New role-check middleware locks out admins | Legacy code fallback preserves existing access |
| Token leak | 7-day default expiry, single-use, revocable, fully audit-logged |
| Token brute-force | 32-char base64 = 192 bits entropy |
| Schema rollback needed | Pure additive changes — `DROP TABLE hackathon_invite` reverts cleanly |
| User accidentally demotes self (last organizer) | Server-side guard: `409 Conflict` if removing/demoting the last organizer |

## Implementation Order (Completed)

1. ✅ Schema migration applied to Supabase
2. ✅ `HackathonInvite` SQLAlchemy model
3. ✅ 9 new API endpoints in `routes/hackathons.py`
4. ✅ `_require_organizer` strict-check helper added
5. ✅ `_require_admin_access` extended to recognize `observer` role
6. ✅ CLI script `create_organizer.py`
7. ✅ Frontend `/hackathons/admin` dashboard
8. ✅ Frontend `/hackathons/<slug>/admin/team` page + client component
9. ✅ Frontend `/hackathons/<slug>/invites/<token>` landing page + accept component
10. ✅ Next.js API proxy routes for session-forwarding

## Files Changed/Added

### Backend
- `ai-engine/app/models/hackathon.py` — added `HackathonInvite`, extended `HackathonRoleType` with `OBSERVER`
- `ai-engine/app/models/hackathon_invite_migration.sql` — new
- `ai-engine/app/routes/hackathons.py` — 9 new endpoints + `_require_organizer` helper
- `ai-engine/scripts/create_organizer.py` — new

### Frontend
- `web-platform/src/app/hackathons/admin/page.tsx` — new
- `web-platform/src/app/hackathons/[slug]/admin/team/page.tsx` — new
- `web-platform/src/app/hackathons/[slug]/invites/[token]/page.tsx` — new
- `web-platform/src/app/api/hackathons/invites/accept/route.ts` — new
- `web-platform/src/app/api/hackathons-proxy/[slug]/invites/route.ts` — new
- `web-platform/src/app/api/hackathons-proxy/[slug]/invites/[inviteId]/route.ts` — new
- `web-platform/src/app/api/hackathons-proxy/[slug]/team/[userId]/route.ts` — new
- `web-platform/src/components/hackathons/SignInCta.tsx` — new
- `web-platform/src/components/hackathons/AcceptInviteClient.tsx` — new
- `web-platform/src/components/hackathons/TeamManagementClient.tsx` — new
- `web-platform/src/lib/hackathons.ts` — added `fetchMyAdminHackathons`, `fetchInvites`, `fetchTeam`, `lookupInvite`, types

## Local Testing Guide

```bash
# 1. Apply migration (already done — but if you reset your DB):
psql $DATABASE_URL -f ai-engine/app/models/hackathon_invite_migration.sql

# 2. Start backend
cd ai-engine
source venv/Scripts/activate    # Windows
uvicorn app.main:app --reload --port 8000

# 3. Start frontend (separate terminal)
cd web-platform
npm run dev

# 4. Provision a test organizer
python ai-engine/scripts/create_organizer.py \
    --email YOUR_EMAIL@example.com \
    --hackathon-slug magic-link-test \
    --hackathon-name "Magic Link Test Event"

# 5. Copy the magic link from the CLI output → paste into browser
#    (note: link points to orenda.vision in prod; for local testing,
#     manually swap the host to http://localhost:3000)

# 6. Sign in with GitHub OAuth → click "Accept invite" → land in /admin

# 7. Navigate to /hackathons/<slug>/admin/team → try inviting yourself
#    again with role=judge → copy the link → open in incognito → sign in
#    with a different GitHub account → verify role assignment
```

## Acceptance Criteria

- [x] ORGANIZER of new hackathon can invite another user as ADMIN via magic link (architecturally; manual QA pending)
- [x] Invited user (logged in) clicks link → lands in admin dashboard
- [x] Invited user (logged out) clicks link → sign-in flow → returns and accepts
- [x] ORGANIZER sees list of pending invites and can revoke
- [x] ORGANIZER sees list of current team members and can remove
- [x] User with hackathon_role on multiple hackathons sees them all at `/hackathons/admin`
- [x] Existing 2 test hackathons with code-based auth keep working unchanged
- [x] Token-based invites are single-use (second click on same link returns 410)
- [x] Expired tokens return 410 on accept
- [x] Revoked tokens return 410 on accept
- [x] Last-organizer guard prevents demoting/removing the only admin
- [ ] **Manual QA: end-to-end click-through complete** (pending)

---

*Built in one session 2026-05-14. Committed to master after manual QA passes.*
