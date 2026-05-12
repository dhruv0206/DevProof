# Hackathon Platform API Contracts

This is the contract surface for the hackathon platform. Frontend agents
build against the shapes documented here; backend agent implements them.
All endpoints are mounted under `/api/hackathons`.

## Conventions

- **Auth**: BetterAuth session cookie (existing pattern). Backend resolves
  current user via `request.state.user` (set by `UserContextMiddleware`).
- **Errors**: 401 if not authed, 403 if wrong role, 404 if not found,
  422 if validation fails. Body shape: `{ "detail": "..." }` or structured
  `{ "detail": { "error_code": "...", "message": "..." } }`.
- **Datetimes**: ISO 8601 strings with timezone, e.g. `2026-05-06T14:30:00Z`.
- **IDs**: UUIDs as strings.
- **Roles**: `organizer | judge | participant`.
- **Audit status**: `pending | running | complete | failed`.
- **Submission status**: `draft | submitted | withdrawn`.

---

## 1. Create event (organizer-only)

```
POST /api/hackathons
```

Body:
```json
{
  "slug": "hackmit-2026",                    // 3-80 chars, lowercase, hyphens
  "name": "HackMIT 2026",                    // public display
  "description": "...",                       // optional, markdown allowed
  "starts_at": "2026-06-01T00:00:00Z",
  "submissions_close_at": "2026-06-02T18:00:00Z",
  "judging_starts_at": "2026-06-03T00:00:00Z",
  "ends_at": "2026-06-03T18:00:00Z",
  "settings": {
    "skip_authorship_check": true,
    "skip_forensics": true,
    "extras_required": ["deployed_url", "demo_video_url"],
    "extras_optional": ["slide_deck_url", "tech_stack_tags"],
    "max_team_size": null,
    "rules_text": "..."
  },
  "sponsors": [
    {"name": "Resend", "packages": ["resend", "@resend/node"], "prize": "$2k"},
    {"name": "Convex", "packages": ["convex"]}
  ]
}
```

Response 201:
```json
{
  "id": "uuid",
  "slug": "hackmit-2026",
  "access_code": "AUTO-GENERATED-32-CHAR",
  "organizer_user_id": "...",
  "created_at": "..."
}
```

Notes:
- Backend auto-generates `access_code` (32 chars, URL-safe).
- Caller is automatically inserted as an `organizer` in `hackathon_role`.
- During white-glove phase, this can be triggered manually by Dhruv on
  behalf of an organizer (no self-serve UI yet).

---

## 2. Fetch event (public)

```
GET /api/hackathons/{slug}
```

Response 200:
```json
{
  "id": "uuid",
  "slug": "hackmit-2026",
  "name": "HackMIT 2026",
  "description": "...",
  "starts_at": "...",
  "submissions_close_at": "...",
  "judging_starts_at": "...",
  "ends_at": "...",
  "is_published": false,
  "sponsors": [{"name": "Resend", "prize": "$2k"}, ...],
  "rules_text": "...",
  "submission_count": 47,             // public count, not the list
  "your_role": "participant" | null,  // null if not authed or not a member
  "your_submission_id": "uuid" | null
}
```

Notes:
- Public — no auth required.
- `your_role` and `your_submission_id` only populated if user is authed.
- `access_code` is NEVER returned here.
- Sponsor `packages` list is hidden from public — only `name` + `prize`.

---

## 3. Join with access code

```
POST /api/hackathons/{slug}/join
```

Body:
```json
{
  "access_code": "..."
}
```

Response 200:
```json
{
  "joined": true,
  "role": "participant",
  "hackathon_id": "uuid"
}
```

Errors:
- 404 if slug not found
- 403 if access_code wrong
- 409 if already joined (return current role rather than erroring)

Side-effect: creates a `hackathon_role` row with `role=participant`.

---

## 4. Submit project

```
POST /api/hackathons/{slug}/submissions
```

Body:
```json
{
  "github_url": "https://github.com/dev/repo",
  "extras": {
    "deployed_url": "https://...",
    "demo_video_url": "https://...",
    "description": "What we built and why",
    "tech_stack_tags": ["python", "react"]
  },
  "team_members": ["alex-chen", "rae-kim"]   // GitHub usernames; submitter excluded
}
```

Response 201:
```json
{
  "submission_id": "uuid",
  "submission_status": "submitted",
  "audit_status": "pending",
  "github_url": "...",
  "team_members": ["alex-chen", "rae-kim"]
}
```

Side-effects:
- Validates GitHub URL is accessible (existing pattern).
- Creates underlying `Project` row + triggers V4 audit via
  `BackgroundTasks.add_task(...)` with `hackathon_mode=True` (matches
  existing pattern at `app/routes/projects.py:401`).
- Sponsor matching runs at audit-complete time and populates
  `matched_sponsors_json`.

Errors:
- 403 if not a participant in this event
- 409 if dev already submitted (`uq_hackathon_submission_per_dev`)
- 422 if `submissions_close_at` has passed
- 422 if any required `extras` field is missing

---

## 5. Update submission (before deadline)

```
PATCH /api/hackathons/{slug}/submissions/{submission_id}
```

Body (all optional — partial update):
```json
{
  "github_url": "...",
  "extras": {...},
  "team_members": [...]
}
```

Response 200: same shape as POST.

Errors:
- 403 if not the submitter
- 409 if `submissions_close_at` has passed (locked)
- 422 if validation fails

Re-triggers audit if `github_url` changed (otherwise just updates extras /
team).

---

## 6. Dev's own submission status (polling target)

```
GET /api/hackathons/{slug}/submissions/{submission_id}
```

Response 200:
```json
{
  "submission_id": "uuid",
  "github_url": "...",
  "extras": {...},
  "team_members": ["alex-chen"],
  "submission_status": "submitted",
  "audit_status": "running",                     // pending | running | complete | failed
  "audit_error": null,
  "repo_score": 73,                              // null if not complete
  "repo_tier": "TIER_2_LOGIC",                   // null if not complete
  "matched_sponsors": {"Resend": 2, "Convex": 1}, // {name: claim_count}
  "v4_output_url": "/api/projects/v4-output/...", // optional, if dev wants details
  "submitted_at": "...",
  "deep_analysis_seconds": 92                    // null if not complete
}
```

Polling cadence: every 15s (matches existing AddProjectModal pattern).

Errors:
- 403 if user is not the submitter or a team member or an organizer/judge.

---

## 7. Organizer dashboard — submissions list

```
GET /api/hackathons/{slug}/admin/submissions
```

Query params:
- `?audit_status=complete` — filter
- `?sort=score_desc | recent` — sort order (default `score_desc`)

Response 200:
```json
{
  "hackathon_id": "uuid",
  "submissions": [
    {
      "submission_id": "uuid",
      "github_url": "...",
      "submitter_username": "alex-chen",
      "team_members": ["alex-chen", "rae-kim"],
      "submission_status": "submitted",
      "audit_status": "complete",
      "repo_score": 87,
      "repo_tier": "TIER_3_DEEP",
      "matched_sponsors": {"Resend": 2},
      "extras": {"deployed_url": "...", ...},
      "submitted_at": "...",
      "deep_analysis_seconds": 110
    },
    ...
  ],
  "total_count": 47,
  "complete_count": 39,
  "running_count": 8,
  "failed_count": 0
}
```

Errors:
- 403 if not organizer or judge of this event.

---

## 8. Publish leaderboard

```
POST /api/hackathons/{slug}/publish
```

Body: empty.

Response 200:
```json
{
  "published": true,
  "published_at": "..."
}
```

Side-effect: sets `hackathon.published_at = NOW()` so the public
leaderboard endpoint becomes accessible.

Errors:
- 403 if not organizer.
- 409 if already published (idempotent — returns current `published_at`).

---

## 9. Public leaderboard (post-publish)

```
GET /api/hackathons/{slug}/leaderboard
```

Response 200 (only if `is_published=true`):
```json
{
  "hackathon_id": "uuid",
  "name": "HackMIT 2026",
  "published_at": "...",
  "rankings": [
    {
      "rank": 1,
      "submission_id": "uuid",
      "submitter_username": "alex-chen",
      "team_members": ["alex-chen", "rae-kim"],
      "github_url": "...",
      "repo_score": 92,
      "repo_tier": "TIER_3_DEEP",
      "matched_sponsors": {"Resend": 2}
    },
    ...
  ],
  "sponsor_leaderboards": {
    "Resend": [{"rank": 1, "submission_id": "...", "repo_score": 92}, ...],
    "Convex": [...]
  }
}
```

Errors:
- 404 if not published yet.

---

## Role gating cheat sheet

| Endpoint | Public | Authenticated | Participant | Organizer | Judge |
|---|---|---|---|---|---|
| `POST /api/hackathons` | ❌ | ✅* | — | — | — |
| `GET /api/hackathons/{slug}` | ✅ | enriched | enriched | enriched | enriched |
| `POST /{slug}/join` | ❌ | ✅ | — | — | — |
| `POST /{slug}/submissions` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `PATCH /{slug}/submissions/{id}` | ❌ | ❌ | submitter only | ❌ | ❌ |
| `GET /{slug}/submissions/{id}` | ❌ | submitter / team / organizer / judge | | | |
| `GET /{slug}/admin/submissions` | ❌ | ❌ | ❌ | ✅ | ✅ |
| `POST /{slug}/publish` | ❌ | ❌ | ❌ | ✅ | ❌ |
| `GET /{slug}/leaderboard` | ✅ if published | | | | |

*Anyone authenticated can call POST `/api/hackathons` during MVP white-glove
phase (we manually approve via email before sharing the access code with
participants). Future versions will gate on an `is_organizer_approved`
flag.

---

## Background audit flow (reference)

When `POST /{slug}/submissions` succeeds:

1. Create `HackathonSubmission` row (status=submitted, audit_status=pending).
2. Create / look up `Project` row for the GitHub URL.
3. Dispatch via existing `BackgroundTasks` pattern:
   ```python
   background_tasks.add_task(
       _run_v4_for_hackathon,
       submission_id=submission.id,
       project_id=project.id,
       hackathon_mode=True,
   )
   ```
4. Background task runs `run_v4_cached(project_id, hackathon_mode=True)`,
   then on success:
   - Updates `hackathon_submission.audit_status = "complete"`
   - Computes sponsor matches via `sponsor_matcher.match_sponsors(claims, hackathon.sponsors)`
   - Stores result in `matched_sponsors_json`
5. On failure: `audit_status = "failed"`, `audit_error = str(exc)`.

The `deep_analysis_seconds` column on `audit_v4_cache` is automatically
populated by `V4CacheService.put` (already shipped).

---

## Open contract questions

These need backend agent's call during implementation:

1. **Cache key for hackathon audits** — should `audit_v4_cache` rows for
   hackathon-mode audits have a discriminator? Current key is
   `(repo_url, code_hash, applicant_username)`. If a dev audits the same
   repo standalone AND in a hackathon, scores will differ (due to
   forensics rescaling). Probably need to skip the cache for
   hackathon-mode audits, OR include a `mode` discriminator. Leaning
   toward **skip the tier-2 cache for hackathons** (always run fresh).

2. **Team member auto-link** — when a non-DevProof user signs up via
   GitHub OAuth and their username is in any submission's
   `team_members_json`, should we auto-link them at sign-up time? Yes —
   add a one-time check in the BetterAuth `afterSignUp` hook (or
   equivalent). Implementation TBD.

3. **Submission lock vs draft** — the schema has `submission_status`
   with `draft | submitted | withdrawn`. For MVP do we expose draft? Or
   is every POST immediately `submitted`? Leaning: every POST is
   `submitted` for MVP simplicity. Update via PATCH stays in `submitted`.
   Skip the draft state.
