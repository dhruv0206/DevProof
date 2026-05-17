"""Hackathon platform API routes.

Implements the 9 endpoints documented in
``docs/HACKATHON_API_CONTRACTS.md``. All endpoints are mounted under
``/api/hackathons``.

Auth model: matches the existing pattern in ``app/routes/users.py`` —
the Next.js BetterAuth layer forwards the authenticated user via the
``X-User-Id`` header (the contracts doc speculatively mentioned a
``request.state.user`` middleware that does not exist; we conform to
the actually-shipped pattern instead).

Audit triggering: when a submission is created/updated with a new
``github_url``, we dispatch a ``BackgroundTasks`` task that runs
``run_v4_cached(..., hackathon_mode=True)``. The hackathon-mode flag
propagates through ``run_v4`` -> ``reduce_phase.reduce`` to drop the
forensics bucket and rescale to 100 (24-72h-old repos have meaningless
forensics signals). Tier-2 cache reads/writes are skipped in this mode
to avoid mixing rescaled scores with standalone audits.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    Header,
    HTTPException,
    Query,
)
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, func, text as sql_text
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.hackathon import (
    AuditStatus,
    Hackathon,
    HackathonInvite,
    HackathonJudgeScore,
    HackathonRole,
    HackathonRoleType,
    HackathonSubmission,
    HackathonTeamMember,
    SubmissionStatus,
    TeamMemberStatus,
)
from app.models.project import Project, ProjectAudit
from app.models.user import User
from app.services.v4_shadow_runner import run_v4_cached

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hackathons", tags=["hackathons"])


# ─── Auth helpers ─────────────────────────────────────────────────────────────

# Shared-secret between Next.js proxies and FastAPI. When set, FastAPI
# refuses any request claiming an X-User-Id without the matching secret —
# this stops anonymous callers from impersonating arbitrary user-ids by
# curling the Cloud Run URL with `-H "X-User-Id: <victim>"`.
#
# Resolved at import time. If unset in local dev, the check degrades to
# "trust X-User-Id" — same as the pre-2026-05-15 behavior — so existing
# dev flows keep working without configuration churn.
#
# In ANY managed runtime we explicitly fail closed: if Cloud Run's
# K_SERVICE env var is set (it always is, automatically, on Cloud Run)
# or ENVIRONMENT == "production", we refuse to start without a secret.
# Without this fail-closed gate, a misconfigured deploy (typo in secret
# name, removed Secret Manager mount, expired version, broken IAM
# binding) would silently degrade the backend back to the original
# impersonable-by-anyone state.
_INTERNAL_PROXY_SECRET = os.environ.get("INTERNAL_PROXY_SECRET", "").strip()

_IS_MANAGED_RUNTIME = (
    bool(os.environ.get("K_SERVICE"))                     # Cloud Run / Cloud Functions
    or os.environ.get("ENVIRONMENT", "").lower() == "production"
)

if _IS_MANAGED_RUNTIME and not _INTERNAL_PROXY_SECRET:
    import sys as _sys
    _sys.stderr.write(
        "\nFATAL: INTERNAL_PROXY_SECRET is required when running in a "
        "managed runtime (detected K_SERVICE or ENVIRONMENT=production) "
        "but was not set.\n"
        "Without it the FastAPI service trusts X-User-Id from any "
        "anonymous internet caller, allowing arbitrary user impersonation.\n"
        "Set it via:  gcloud run services update <service> "
        "--update-secrets=INTERNAL_PROXY_SECRET=internal-proxy-secret:latest\n"
        "Refusing to start.\n\n"
    )
    _sys.exit(1)


def _check_proxy_secret(provided: Optional[str]) -> None:
    """Reject if the secret is configured but the provided header is
    missing/wrong. No-op when ``INTERNAL_PROXY_SECRET`` is unset (dev).
    """
    if not _INTERNAL_PROXY_SECRET:
        return  # dev mode — no enforcement
    if not provided or provided != _INTERNAL_PROXY_SECRET:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing internal proxy credentials",
        )


def _current_user_id(
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_internal_proxy_secret: Optional[str] = Header(
        default=None, alias="X-Internal-Proxy-Secret",
    ),
) -> str:
    """Resolve the authenticated user-id from the X-User-Id header.

    BetterAuth runs in the Next.js layer; the server-side proxy forwards
    the resolved user-id as ``X-User-Id`` plus a shared
    ``X-Internal-Proxy-Secret``. We validate the secret BEFORE trusting
    the user-id claim — without this, any anonymous caller could
    impersonate any user by curling FastAPI directly with the victim's
    user-id in the header.

    Missing X-User-Id => 401 (unauthenticated).
    Missing/wrong secret (when configured) => 401 (untrusted caller).
    """
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    _check_proxy_secret(x_internal_proxy_secret)
    return x_user_id


def _optional_user_id(
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    x_internal_proxy_secret: Optional[str] = Header(
        default=None, alias="X-Internal-Proxy-Secret",
    ),
) -> Optional[str]:
    """Like ``_current_user_id`` but returns ``None`` for anonymous callers
    instead of raising. Anonymous callers (no X-User-Id) skip the secret
    check entirely — public endpoints stay public. Callers that DO claim
    a user-id must also present the secret, same as ``_current_user_id``.
    """
    if not x_user_id:
        return None
    _check_proxy_secret(x_internal_proxy_secret)
    return x_user_id


def _require_role(
    db: Session, hackathon_id: uuid.UUID, user_id: str, *allowed: str,
) -> HackathonRole:
    """Look up the caller's role in this hackathon and 403 if not allowed.

    ``allowed`` is a tuple of role-strings (``"organizer"``, ``"judge"``,
    ``"participant"``). Returns the row so the route can introspect.
    """
    role = db.query(HackathonRole).filter(
        HackathonRole.hackathon_id == hackathon_id,
        HackathonRole.user_id == user_id,
    ).first()
    if role is None or role.role not in allowed:
        raise HTTPException(
            status_code=403,
            detail="You don't have access to this hackathon",
        )
    return role


def _is_platform_admin(db: Session, user_id: Optional[str]) -> bool:
    """Return True iff this user has the platform-admin flag set.

    Platform admins (DevProof staff, created via ``scripts/create_admin.py
    --platform-admin``) get full read/write access to every hackathon on
    the platform — they don't need a per-event role row.
    """
    if not user_id:
        return False
    row = db.execute(
        sql_text('SELECT "isPlatformAdmin" FROM "user" WHERE id = :uid'),
        {"uid": user_id},
    ).first()
    return bool(row and row[0])


def _require_admin_access(
    db: Session,
    hackathon: Hackathon,
    user_id: Optional[str],
) -> str:
    """Admin-tier access check (read or read-write depending on role).

    Requires a signed-in user with ORGANIZER, JUDGE, or OBSERVER role on
    THIS specific hackathon. Platform admins are intentionally NOT
    auto-passed — organizers expect their submissions to be private from
    DevProof staff. Platform admins use the narrow reissue-invite
    endpoint instead of full event access.

    Returns a string label for audit logs: ``"role:<role>"``. Raises 403
    otherwise.
    """
    if user_id:
        role = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == hackathon.id,
            HackathonRole.user_id == user_id,
        ).first()
        if role is not None and role.role in (
            HackathonRoleType.ORGANIZER.value,
            HackathonRoleType.JUDGE.value,
            HackathonRoleType.OBSERVER.value,
        ):
            return f"role:{role.role}"

    raise HTTPException(
        status_code=403,
        detail="Admin access required — sign in via the magic link sent to your email",
    )


def _require_organizer(
    db: Session,
    hackathon: Hackathon,
    user_id: Optional[str],
) -> str:
    """Strict organizer-only check (write actions: invite, remove, settings).

    Judges/observers cannot invite or remove team members. Platform
    admins are not auto-passed here either — they have a separate narrow
    endpoint (``platform-reissue-invite``) that only mints magic links
    and never exposes submission data.
    """
    if user_id:
        role = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == hackathon.id,
            HackathonRole.user_id == user_id,
            HackathonRole.role == HackathonRoleType.ORGANIZER.value,
        ).first()
        if role is not None:
            return f"role:{role.role}"

    raise HTTPException(
        status_code=403,
        detail="Organizer access required",
    )


def _get_hackathon_by_slug(db: Session, slug: str) -> Hackathon:
    h = db.query(Hackathon).filter(Hackathon.slug == slug).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Hackathon not found")
    return h


def _submissions_are_locked(hackathon: Hackathon) -> bool:
    """True iff submissions are currently locked from edits.

    Two independent gates, either of which locks the event:

      1. ``submissions_locked_override`` (manual organizer toggle) — instant
         lock regardless of schedule.
      2. ``submissions_close_at`` — scheduled deadline. Once passed, edits
         and new submissions are blocked.

    Callers should treat the lock as advisory for new submissions (return 422
    "submissions are closed") and as strict for edits (return 409 with the
    same message). The split is conventional but both call _submissions_are_locked
    underneath so the policy stays in one place.
    """
    if bool(getattr(hackathon, "submissions_locked_override", False)):
        return True
    close_at = hackathon.submissions_close_at
    if close_at is None:
        return False
    if close_at.tzinfo is None:
        close_at = close_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > close_at


def _require_submissions_open(
    hackathon: Hackathon,
    *,
    code: int = 409,
    detail: str = "Submissions are locked",
) -> None:
    """Raise HTTPException if submissions are locked. Default 409 (edit
    attempt); pass code=422 for the create endpoint."""
    if _submissions_are_locked(hackathon):
        raise HTTPException(status_code=code, detail=detail)


# ─── Validation helpers ───────────────────────────────────────────────────────

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_GITHUB_URL_RE = re.compile(
    r"^https?://github\.com/[^/]+/[^/]+?(?:\.git)?/?$"
)


def _validate_slug(slug: str) -> str:
    if not (3 <= len(slug) <= 80):
        raise HTTPException(
            status_code=422,
            detail="slug must be 3-80 characters",
        )
    if not _SLUG_RE.match(slug):
        raise HTTPException(
            status_code=422,
            detail="slug must be lowercase alphanumeric with hyphens",
        )
    return slug


def _validate_github_url(url: str) -> str:
    if not _GITHUB_URL_RE.match(url):
        raise HTTPException(
            status_code=422,
            detail="github_url must be a valid github.com repository URL",
        )
    return url


def _generate_access_code() -> str:
    """Single shared access code per event. ``token_urlsafe(24)`` yields a
    32-char URL-safe string."""
    return secrets.token_urlsafe(24)


def _ensure_extras_complete(extras: dict, required: list[str]) -> None:
    """422 if any required-extras key is missing or blank."""
    missing = []
    for key in required or []:
        val = extras.get(key) if isinstance(extras, dict) else None
        if val is None or (isinstance(val, str) and not val.strip()):
            missing.append(key)
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": "missing_required_extras",
                "message": f"Missing required fields: {', '.join(missing)}",
                "missing_fields": missing,
            },
        )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _score_is_visible_to_submitter(
    hackathon: Hackathon,
) -> bool:
    """Should the submitter (or any non-organizer) see their concrete score?

    Default for hackathon mode: ``hide_until_publish`` — keep the number,
    tier, and sponsor matches private until the organizer publishes the
    leaderboard. The submitter still sees audit ``pending/running/complete/
    failed`` for iteration purposes; the score itself is masked.

    The organizer can override per-event via ``settings_json.score_visibility``:
      - ``"hide_until_publish"`` (default): only after ``published_at`` is set
      - ``"show_immediately"``: visible to submitter as soon as audit completes
      - ``"reveal_after_close"``: visible after submissions_close_at, even if
        the public leaderboard hasn't been published yet
    """
    settings = hackathon.settings_json or {}
    mode = (settings.get("score_visibility") or "hide_until_publish").strip()

    if mode == "show_immediately":
        return True
    if hackathon.published_at is not None:
        return True
    if mode == "reveal_after_close":
        if hackathon.submissions_close_at is None:
            return False
        # Postgres TIMESTAMPTZ returns tz-aware datetimes; mirror that.
        close = hackathon.submissions_close_at
        if close.tzinfo is None:
            close = close.replace(tzinfo=timezone.utc)
        return _now() > close
    return False


def _serialize_submission(
    sub: HackathonSubmission,
    *,
    audit: Optional[ProjectAudit] = None,
    hackathon: Optional[Hackathon] = None,
    score_visible: bool = True,
) -> dict[str, Any]:
    """Public/private submission shape — matches contracts §6 + §7.

    When ``score_visible`` is False, the score / tier / matched sponsors are
    stripped from the response. Audit status + error remain so the dev can
    iterate and so failures are still surfaced.
    """
    matched = sub.matched_sponsors_json or {}
    sponsor_counts = {name: len(claim_ids) for name, claim_ids in matched.items()}

    repo_score = None
    repo_tier = None
    deep_seconds = None
    if audit is not None and audit.v4_output is not None:
        repo_score = audit.v4_score
        repo_tier = audit.v4_tier
        try:
            latencies = (
                (audit.v4_output or {})
                .get("pipeline_meta", {})
                .get("stage_latencies_ms", {})
            ) or {}
            total_ms = sum(int(latencies.get(k) or 0) for k in (
                "ingest", "skeleton", "tag", "map", "reduce", "verify",
            ))
            deep_seconds = round(total_ms / 1000) if total_ms > 0 else None
        except Exception:  # noqa: BLE001
            deep_seconds = None

    payload = {
        "submission_id": str(sub.id),
        "github_url": sub.github_url,
        "extras": sub.extras_json or {},
        "team_members": sub.team_members_json or [],
        # New first-class fields (added 2026-05-17).
        "tagline": sub.tagline,
        "what_it_does": sub.what_it_does,
        "demo_url": sub.demo_url,
        "team_name": sub.team_name,
        "tracks_opted_out": list(sub.tracks_opted_out_json or []),
        "submission_status": sub.submission_status,
        "audit_status": sub.audit_status,
        "audit_error": sub.audit_error,
        "repo_score": repo_score if score_visible else None,
        "repo_tier": repo_tier if score_visible else None,
        "matched_sponsors": sponsor_counts if score_visible else {},
        "score_visible": bool(score_visible and repo_score is not None),
        "score_hidden_reason": (
            None
            if score_visible or repo_score is None
            else "leaderboard_not_published"
        ),
        "v4_output_url": (
            f"/api/projects/status/{sub.project_id}"
            if sub.project_id else None
        ),
        "submitted_at": _isoformat(sub.submitted_at),
        "deep_analysis_seconds": deep_seconds,
        "pinned_to_profile": bool(getattr(sub, "pinned_to_profile", False)),
    }
    return payload


# ─── Background audit dispatch ────────────────────────────────────────────────

def _run_v4_for_hackathon_submission(
    submission_id: str,
    project_id: str,
    hackathon_mode: bool = True,
) -> None:
    """Background task: run V4 in hackathon-mode and update the submission row.

    Mirrors the ``_run_v4_primary_background`` pattern in projects.py but
    targets the ``HackathonSubmission`` row instead of ``ProjectAudit``.
    Also computes sponsor matches at audit-complete time and stores
    them on ``matched_sponsors_json``.

    On failure: ``audit_status="failed"`` and ``audit_error=str(exc)``.
    """
    if SessionLocal is None:
        log.warning("[hackathon-bg] no DB session, skipping submission=%s", submission_id)
        return

    # Resolve repo_url + applicant_username + sponsors_json before kicking
    # off the long-running pipeline so we don't hold a session open.
    session = SessionLocal()
    try:
        sub = session.query(HackathonSubmission).filter(
            HackathonSubmission.id == uuid.UUID(submission_id),
        ).first()
        if sub is None:
            log.error("[hackathon-bg] submission %s not found", submission_id)
            return
        hackathon = session.query(Hackathon).filter(
            Hackathon.id == sub.hackathon_id,
        ).first()
        if hackathon is None:
            log.error("[hackathon-bg] hackathon for submission %s not found", submission_id)
            return
        user = session.query(User).filter(User.id == sub.submitter_user_id).first()
        applicant_username = user.githubUsername if user else None

        repo_url = sub.github_url
        sponsors_config = list(hackathon.sponsors_json or [])

        # Mark running before the long pipeline starts
        sub.audit_status = AuditStatus.RUNNING.value
        sub.audit_error = None
        sub.updated_at = _now()
        session.commit()
    except Exception as e:  # noqa: BLE001
        log.error("[hackathon-bg] pre-flight failed for %s: %s", submission_id, e)
        session.rollback()
        session.close()
        return
    finally:
        session.close()

    # Run the V4 pipeline (no DB session held during the ~minutes-long call).
    try:
        payload = asyncio.run(
            run_v4_cached(
                repo_url,
                github_username=applicant_username,
                db_session_factory=SessionLocal,
                run_full_pipeline=True,
                enable_verify=False,
                hackathon_mode=hackathon_mode,
            )
        )
    except Exception as e:  # noqa: BLE001
        log.error("[hackathon-bg] run_v4_cached raised: %s", e)
        _mark_submission_failed(submission_id, f"pipeline error: {e}")
        return

    succeeded = bool(payload.get("succeeded"))
    v4_out = payload.get("v4_output") or {}
    if not succeeded or not v4_out:
        _mark_submission_failed(
            submission_id,
            f"v4 produced no output (errors: {payload.get('errors') or []})",
        )
        return

    # Compute sponsor matches against the sponsor config.
    #
    # Two-pass matching, both running off the same V4 output:
    #   1. Algo's ``match_sponsors`` — exact-package match for sponsors
    #      whose ``packages`` list is populated.
    #   2. Hackathon-side ``compute_name_only_matches`` — name-based
    #      whole-word match for sponsors with empty ``packages`` (lets
    #      organizers add a sponsor by brand name alone). Lives in the
    #      hackathon service layer; doesn't touch the algo.
    sponsor_match: dict[str, list[str]] = {}
    try:
        # Lazy import to avoid pulling the ranking algo on cold start
        from devproof_ranking_algo.schema.v4_output import V4Output
        from devproof_ranking_algo.v4.sponsor_matcher import match_sponsors
        from app.services.hackathon_audit_view import compute_name_only_matches

        # Rehydrate V4Output so claim.sdk_packages_used is the real list[str]
        v4_obj = V4Output.model_validate(v4_out)
        sponsor_match = match_sponsors(v4_obj.claims, sponsors_config)

        name_matches = compute_name_only_matches(v4_out, sponsors_config)
        for sname, pkgs in name_matches.items():
            existing = set(sponsor_match.get(sname) or [])
            existing.update(pkgs)
            sponsor_match[sname] = sorted(existing)
    except Exception as e:  # noqa: BLE001
        # Sponsor match is best-effort — log and continue with empty match
        log.warning("[hackathon-bg] sponsor_match failed for %s: %s", submission_id, e)
        sponsor_match = {}

    # Persist results: also update the underlying ProjectAudit row so the
    # frontend's existing /me/projects + status polling pages keep working.
    session = SessionLocal()
    try:
        sub = session.query(HackathonSubmission).filter(
            HackathonSubmission.id == uuid.UUID(submission_id),
        ).first()
        if sub is None:
            log.error("[hackathon-bg] submission %s vanished mid-flight", submission_id)
            return

        sub.audit_status = AuditStatus.COMPLETE.value
        sub.audit_error = None
        sub.matched_sponsors_json = sponsor_match
        sub.updated_at = _now()

        # Also fill in the underlying ProjectAudit so the standard project
        # surfaces (status polling, /me/projects) reflect the audit. We
        # treat the project as VERIFIED on success — same semantics as the
        # standalone /import flow.
        if sub.project_id is not None:
            audit_row = session.query(ProjectAudit).filter(
                ProjectAudit.project_id == sub.project_id,
            ).first()
            if audit_row is not None:
                audit_row.v4_score = v4_out.get("repo_score")
                audit_row.v4_tier = v4_out.get("repo_tier")
                audit_row.v4_output = v4_out
                audit_row.v4_audited_at = _now()
                audit_row.tds_score = v4_out.get("repo_score")
                audit_row.scoring_version = 4
                audit_row.discipline = v4_out.get("discipline")
                audit_row.forensics_data = v4_out.get("forensics")

            project_row = session.query(Project).filter(
                Project.id == sub.project_id,
            ).first()
            if project_row is not None:
                project_row.is_verified = True
                project_row.verification_status = "VERIFIED"
                project_row.authorship_percent = (
                    v4_out.get("authorship_percent") or 0.0
                )

        session.commit()
        log.info(
            "[hackathon-bg] submission=%s complete score=%s sponsors=%s",
            submission_id, v4_out.get("repo_score"), list(sponsor_match.keys()),
        )
    except Exception as e:  # noqa: BLE001
        log.error("[hackathon-bg] DB write failed for %s: %s", submission_id, e)
        session.rollback()
        _mark_submission_failed(submission_id, f"db error: {e}")
    finally:
        session.close()


def _mark_submission_failed(submission_id: str, reason: str) -> None:
    """Best-effort failure marking. Silent on errors."""
    if SessionLocal is None:
        return
    session = SessionLocal()
    try:
        sub = session.query(HackathonSubmission).filter(
            HackathonSubmission.id == uuid.UUID(submission_id),
        ).first()
        if sub is not None:
            sub.audit_status = AuditStatus.FAILED.value
            sub.audit_error = reason[:2000] if reason else "unknown error"
            sub.updated_at = _now()
            session.commit()
            log.warning("[hackathon-bg] submission=%s FAILED: %s", submission_id, reason)
    except Exception as e:  # noqa: BLE001
        log.error("[hackathon-bg] _mark_submission_failed: %s", e)
        session.rollback()
    finally:
        session.close()


def _create_or_get_project_for_submission(
    db: Session, *, user_id: str, repo_url: str,
) -> tuple[Project, ProjectAudit]:
    """Create (or reuse) a Project + ProjectAudit row for a submission.

    Reuses the existing dedup behaviour from projects.py /import — same
    user importing the same repo gets the same Project row. We attach
    the hackathon submission to it and run a fresh hackathon-mode audit.
    """
    repo_name = repo_url.rstrip("/").split("/")[-1].removesuffix(".git")
    project = db.query(Project).filter(
        Project.user_id == user_id,
        Project.repo_url == repo_url,
    ).first()

    if project is None:
        project = Project(
            user_id=user_id,
            repo_url=repo_url,
            repo_name=repo_name,
            is_verified=False,
            verification_status="PENDING",
            authorship_percent=0.0,
        )
        db.add(project)
        db.flush()  # populate project.id

    audit = db.query(ProjectAudit).filter(
        ProjectAudit.project_id == project.id,
    ).first()
    if audit is None:
        audit = ProjectAudit(
            project_id=project.id,
            tds_score=None,
            complexity_tier=None,
            scoring_version=4,
        )
        db.add(audit)
        db.flush()

    return project, audit


# ─── Pydantic request bodies ──────────────────────────────────────────────────

class SponsorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    packages: list[str] = Field(default_factory=list)
    prize: Optional[str] = Field(default=None, max_length=200)


class HackathonSettingsIn(BaseModel):
    skip_authorship_check: bool = True
    skip_forensics: bool = True
    extras_required: list[str] = Field(default_factory=list)
    extras_optional: list[str] = Field(default_factory=list)
    max_team_size: Optional[int] = Field(default=None, ge=1, le=50)
    rules_text: Optional[str] = None


class CreateHackathonRequest(BaseModel):
    slug: str = Field(min_length=3, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    starts_at: Optional[datetime] = None
    submissions_close_at: Optional[datetime] = None
    judging_starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    settings: HackathonSettingsIn = Field(default_factory=HackathonSettingsIn)
    sponsors: list[SponsorIn] = Field(default_factory=list)

    @field_validator("slug")
    @classmethod
    def _check_slug(cls, v: str) -> str:
        if not _SLUG_RE.match(v):
            raise ValueError("slug must be lowercase alphanumeric with hyphens")
        return v


class JoinHackathonRequest(BaseModel):
    access_code: str = Field(min_length=1, max_length=64)


class SubmissionExtrasIn(BaseModel):
    """Free-form extras bag — we don't enforce shape here, organizer's
    ``extras_required`` config drives validation at submit time."""
    model_config = {"extra": "allow"}


class CreateSubmissionRequest(BaseModel):
    github_url: str = Field(min_length=10, max_length=500)
    extras: dict[str, Any] = Field(default_factory=dict)
    team_members: list[str] = Field(default_factory=list)
    # New first-class fields (added 2026-05-17). All optional on create so
    # devs can save a draft-quality submission and edit later.
    tagline: Optional[str] = Field(default=None, max_length=140)
    what_it_does: Optional[str] = Field(default=None, max_length=500)
    demo_url: Optional[str] = Field(default=None, max_length=500)
    team_name: Optional[str] = Field(default=None, max_length=80)
    tracks_opted_out: list[str] = Field(default_factory=list)


class UpdateSubmissionRequest(BaseModel):
    github_url: Optional[str] = Field(default=None, min_length=10, max_length=500)
    extras: Optional[dict[str, Any]] = None
    team_members: Optional[list[str]] = None
    tagline: Optional[str] = Field(default=None, max_length=140)
    what_it_does: Optional[str] = Field(default=None, max_length=500)
    demo_url: Optional[str] = Field(default=None, max_length=500)
    team_name: Optional[str] = Field(default=None, max_length=80)
    tracks_opted_out: Optional[list[str]] = None


# ─── Endpoint 1: Create event ─────────────────────────────────────────────────

@router.post("", status_code=201)
def create_hackathon(
    body: CreateHackathonRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Create a new hackathon. Caller becomes the organizer.

    Per contracts §1: any authenticated user can create during the MVP
    white-glove phase (no self-serve gate yet).
    """
    _validate_slug(body.slug)

    # Slug uniqueness
    existing = db.query(Hackathon).filter(Hackathon.slug == body.slug).first()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"slug '{body.slug}' is already taken",
        )

    # Validate dates are coherent (best-effort — None is allowed)
    dates = [body.starts_at, body.submissions_close_at,
             body.judging_starts_at, body.ends_at]
    populated = [d for d in dates if d is not None]
    if len(populated) >= 2 and populated != sorted(populated):
        raise HTTPException(
            status_code=422,
            detail="event dates must be in chronological order",
        )

    hackathon = Hackathon(
        slug=body.slug,
        name=body.name,
        description=body.description,
        organizer_user_id=user_id,
        starts_at=body.starts_at,
        submissions_close_at=body.submissions_close_at,
        judging_starts_at=body.judging_starts_at,
        ends_at=body.ends_at,
        access_code=_generate_access_code(),
        organizer_access_code=None,  # legacy code-paste auth removed; magic links only
        settings_json=body.settings.model_dump(),
        sponsors_json=[s.model_dump() for s in body.sponsors],
    )
    db.add(hackathon)
    db.flush()  # populate id

    # Insert organizer role row for the creator
    db.add(HackathonRole(
        hackathon_id=hackathon.id,
        user_id=user_id,
        role=HackathonRoleType.ORGANIZER.value,
    ))
    db.commit()
    db.refresh(hackathon)

    return {
        "id": str(hackathon.id),
        "slug": hackathon.slug,
        "access_code": hackathon.access_code,
        "organizer_user_id": hackathon.organizer_user_id,
        "created_at": _isoformat(hackathon.created_at),
    }


# ─── Endpoint 1b: List events (public index) ──────────────────────────────────

@router.get("")
def list_hackathons(
    db: Session = Depends(get_db),
):
    """Public browse-all index. Used by `/hackathons` on the frontend.

    Sort: live + upcoming first (anything whose `ends_at` >= NOW), then by
    `starts_at` desc. Per-event fields mirror ``HackathonListItem`` on the
    frontend — sponsor ``packages`` are stripped, access_code never returned.
    """
    rows = db.query(Hackathon).order_by(Hackathon.starts_at.desc()).all()

    # Submission counts per hackathon (one query, fanout map).
    counts_rows = db.query(
        HackathonSubmission.hackathon_id,
        func.count(HackathonSubmission.id),
    ).filter(
        HackathonSubmission.submission_status == SubmissionStatus.SUBMITTED.value,
    ).group_by(HackathonSubmission.hackathon_id).all()
    counts = {hid: n for hid, n in counts_rows}

    items = []
    for h in rows:
        public_sponsors = [
            {"name": s.get("name"), "prize": s.get("prize")}
            for s in (h.sponsors_json or [])
            if isinstance(s, dict) and s.get("name")
        ]
        items.append({
            "slug": h.slug,
            "name": h.name,
            "starts_at": _isoformat(h.starts_at),
            "submissions_close_at": _isoformat(h.submissions_close_at),
            "ends_at": _isoformat(h.ends_at),
            "is_published": h.published_at is not None,
            "submission_count": counts.get(h.id, 0),
            "sponsors": public_sponsors,
        })

    return {"hackathons": items}


# ─── Endpoint 1d: Pinned hackathons by username (public) ──────────────────────

@router.get("/pinned-by/{username}")
def list_pinned_by_user(
    username: str,
    db: Session = Depends(get_db),
):
    """Public — return hackathon submissions that ``@{username}`` has pinned
    to their DevProof profile. Drives the "Hackathons" section on
    /p/{username}. Score / sponsors are visible because the dev opted in by
    pinning, regardless of the event's score_visibility setting (a pinned
    achievement is by definition something they want shown).
    """
    user = db.query(User).filter(User.githubUsername == username).first()
    if user is None:
        return {"username": username, "pinned": []}

    pins = db.query(HackathonSubmission).filter(
        HackathonSubmission.submitter_user_id == user.id,
        HackathonSubmission.pinned_to_profile == True,  # noqa: E712
        HackathonSubmission.audit_status == AuditStatus.COMPLETE.value,
    ).all()
    if not pins:
        return {"username": username, "pinned": []}

    hids = list({p.hackathon_id for p in pins})
    hackathons_by_id = {
        h.id: h for h in db.query(Hackathon).filter(Hackathon.id.in_(hids)).all()
    }

    audit_by_pid: dict[uuid.UUID, ProjectAudit] = {}
    project_ids = [p.project_id for p in pins if p.project_id]
    if project_ids:
        for a in db.query(ProjectAudit).filter(
            ProjectAudit.project_id.in_(project_ids),
        ).all():
            audit_by_pid[a.project_id] = a

    items: list[dict[str, Any]] = []
    for p in pins:
        h = hackathons_by_id.get(p.hackathon_id)
        if h is None:
            continue
        a = audit_by_pid.get(p.project_id) if p.project_id else None
        sub_payload = _serialize_submission(
            p, audit=a, hackathon=h, score_visible=True,
        )
        items.append({
            "hackathon": {
                "id": str(h.id),
                "slug": h.slug,
                "name": h.name,
                "starts_at": _isoformat(h.starts_at),
                "ends_at": _isoformat(h.ends_at),
                "is_published": h.published_at is not None,
                "sponsors": [
                    {"name": s.get("name"), "prize": s.get("prize")}
                    for s in (h.sponsors_json or [])
                    if isinstance(s, dict) and s.get("name")
                ],
            },
            "submission": sub_payload,
        })
    items.sort(key=lambda x: (x["hackathon"]["ends_at"] or ""), reverse=True)
    return {"username": username, "pinned": items}


# ─── Endpoint 1c: My hackathons (logged-in dev view) ──────────────────────────

@router.get("/mine")
def list_my_hackathons(
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """List the hackathons the current user is involved in, with their role
    and submission state. Drives the dev-side `/hackathons` dashboard view.

    Splits naturally into "active" (event window not yet over) and "past"
    (ended). Frontend filters from this single payload.
    """
    role_rows = db.query(HackathonRole).filter(
        HackathonRole.user_id == user_id,
    ).all()

    # Team-membership lookup: hackathons where the user has accepted a
    # teammate invite, even if they have no direct role row yet (the accept
    # path grants a role too, so this is just defensive coverage of edge
    # cases where the role insert failed but the team_member row succeeded).
    team_subs = db.query(HackathonSubmission).join(
        HackathonTeamMember,
        HackathonTeamMember.submission_id == HackathonSubmission.id,
    ).filter(
        HackathonTeamMember.accepted_user_id == user_id,
        HackathonTeamMember.status == TeamMemberStatus.ACCEPTED.value,
    ).all()

    if not role_rows and not team_subs:
        return {"events": []}

    role_by_hid = {r.hackathon_id: r.role for r in role_rows}
    hackathon_id_set = set(role_by_hid)
    hackathon_id_set.update(s.hackathon_id for s in team_subs)
    hackathon_ids = list(hackathon_id_set)
    if not hackathon_ids:
        return {"events": []}

    hackathons = db.query(Hackathon).filter(Hackathon.id.in_(hackathon_ids)).all()

    # The user's "primary" submission for each event = the one they submitted
    # themselves, OR (fallback) the team submission they're a member of.
    own_subs = db.query(HackathonSubmission).filter(
        HackathonSubmission.hackathon_id.in_(hackathon_ids),
        HackathonSubmission.submitter_user_id == user_id,
    ).all()
    sub_by_hid: dict[Any, HackathonSubmission] = {s.hackathon_id: s for s in own_subs}
    for s in team_subs:
        sub_by_hid.setdefault(s.hackathon_id, s)
    sub_rows = list(sub_by_hid.values())

    # Audits for those submissions
    audit_by_pid: dict[uuid.UUID, ProjectAudit] = {}
    project_ids = [s.project_id for s in sub_rows if s.project_id]
    if project_ids:
        for a in db.query(ProjectAudit).filter(
            ProjectAudit.project_id.in_(project_ids),
        ).all():
            audit_by_pid[a.project_id] = a

    now = _now()
    events: list[dict[str, Any]] = []
    for h in hackathons:
        sub = sub_by_hid.get(h.id)
        audit = audit_by_pid.get(sub.project_id) if sub and sub.project_id else None
        is_staff = role_by_hid.get(h.id) in (
            HackathonRoleType.ORGANIZER.value, HackathonRoleType.JUDGE.value,
        )
        visible = is_staff or _score_is_visible_to_submitter(h)
        sub_payload: Optional[dict[str, Any]] = None
        if sub is not None:
            sub_payload = _serialize_submission(
                sub, audit=audit, hackathon=h, score_visible=visible,
            )

        ends_at = h.ends_at
        if ends_at is not None and ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=timezone.utc)
        ended = ends_at is not None and now > ends_at
        events.append({
            "hackathon": {
                "id": str(h.id),
                "slug": h.slug,
                "name": h.name,
                "starts_at": _isoformat(h.starts_at),
                "submissions_close_at": _isoformat(h.submissions_close_at),
                "ends_at": _isoformat(h.ends_at),
                "is_published": h.published_at is not None,
            },
            "your_role": role_by_hid.get(h.id),
            "ended": ended,
            "submission": sub_payload,
        })

    events.sort(
        key=lambda e: (e["hackathon"]["starts_at"] or ""),
        reverse=True,
    )
    return {"events": events}


# ─── Endpoint 2: Fetch event (public) ─────────────────────────────────────────

@router.get("/{slug}")
def get_hackathon(
    slug: str,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),
):
    """Public event metadata. Authed callers also get ``your_role`` and
    ``your_submission_id``. Never returns the access_code or sponsor packages.
    """
    h = _get_hackathon_by_slug(db, slug)

    submission_count = db.query(func.count(HackathonSubmission.id)).filter(
        HackathonSubmission.hackathon_id == h.id,
        HackathonSubmission.submission_status == SubmissionStatus.SUBMITTED.value,
    ).scalar() or 0

    your_role: Optional[str] = None
    your_submission_id: Optional[str] = None
    your_submission_role: Optional[str] = None  # "submitter" | "teammate" | None
    if user_id:
        role_row = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == h.id,
            HackathonRole.user_id == user_id,
        ).first()
        if role_row is not None:
            your_role = role_row.role

        # Own submission takes precedence over team membership.
        sub_row = db.query(HackathonSubmission).filter(
            HackathonSubmission.hackathon_id == h.id,
            HackathonSubmission.submitter_user_id == user_id,
        ).first()
        if sub_row is not None:
            your_submission_id = str(sub_row.id)
            your_submission_role = "submitter"
        else:
            # Fall back to a team membership (accepted teammates land on
            # the same /me page and edit the submitter's submission).
            team_sub = db.query(HackathonSubmission).join(
                HackathonTeamMember,
                HackathonTeamMember.submission_id == HackathonSubmission.id,
            ).filter(
                HackathonSubmission.hackathon_id == h.id,
                HackathonTeamMember.accepted_user_id == user_id,
                HackathonTeamMember.status == TeamMemberStatus.ACCEPTED.value,
            ).first()
            if team_sub is not None:
                your_submission_id = str(team_sub.id)
                your_submission_role = "teammate"

    # Strip ``packages`` from public sponsor list — only name + prize visible
    public_sponsors = [
        {"name": s.get("name"), "prize": s.get("prize")}
        for s in (h.sponsors_json or [])
        if isinstance(s, dict) and s.get("name")
    ]

    settings = h.settings_json or {}
    public_settings = {
        "extras_required": settings.get("extras_required") or [],
        "extras_optional": settings.get("extras_optional") or [],
        "max_team_size": settings.get("max_team_size"),
        "rules_text": settings.get("rules_text"),
    }
    # access_code is included ONLY for organizers/judges so they can show
    # it on the admin dashboard for participants to join. Everyone else
    # gets it stripped out — even public sponsor packages are scrubbed
    # above to avoid leaking competitive info.
    response: dict[str, Any] = {
        "id": str(h.id),
        "slug": h.slug,
        "name": h.name,
        "description": h.description,
        "starts_at": _isoformat(h.starts_at),
        "submissions_close_at": _isoformat(h.submissions_close_at),
        "judging_starts_at": _isoformat(h.judging_starts_at),
        "ends_at": _isoformat(h.ends_at),
        "is_published": h.published_at is not None,
        "sponsors": public_sponsors,
        "rules_text": settings.get("rules_text"),
        "settings": public_settings,
        "submission_count": submission_count,
        "your_role": your_role,
        "your_submission_id": your_submission_id,
        "your_submission_role": your_submission_role,
        # Effective lock state — true iff submissions are currently closed for
        # edits (scheduled close passed OR manual override on). Drives the
        # UI's edit-button visibility and read-only banners.
        "submissions_locked": _submissions_are_locked(h),
    }
    if your_role in ("organizer", "judge"):
        response["access_code"] = h.access_code
        response["show_sponsor_evidence"] = bool(
            (h.settings_json or {}).get("show_sponsor_evidence")
        )
        # Organizer-only: surface the lock components separately so the admin
        # UI can render the toggle state + scheduled close field distinctly.
        response["submissions_locked_override"] = bool(
            h.submissions_locked_override
        )
    return response


# ─── Endpoint 3: Join with access code ────────────────────────────────────────

@router.post("/{slug}/join")
def join_hackathon(
    slug: str,
    body: JoinHackathonRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Verify access_code and grant ``participant`` role. Idempotent: if
    already a member, return the current role rather than 409."""
    h = _get_hackathon_by_slug(db, slug)

    if not secrets.compare_digest(body.access_code or "", h.access_code or ""):
        raise HTTPException(status_code=403, detail="Invalid access code")

    existing = db.query(HackathonRole).filter(
        HackathonRole.hackathon_id == h.id,
        HackathonRole.user_id == user_id,
    ).first()
    if existing is not None:
        return {
            "joined": True,
            "role": existing.role,
            "hackathon_id": str(h.id),
        }

    new_role = HackathonRole(
        hackathon_id=h.id,
        user_id=user_id,
        role=HackathonRoleType.PARTICIPANT.value,
    )
    db.add(new_role)
    db.commit()
    return {
        "joined": True,
        "role": new_role.role,
        "hackathon_id": str(h.id),
    }


# ─── Endpoint 4: Submit project ───────────────────────────────────────────────

@router.post("/{slug}/submissions", status_code=201)
def create_submission(
    slug: str,
    body: CreateSubmissionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Create a hackathon submission and dispatch a hackathon-mode V4 audit.

    Requires participant role. One submission per dev (enforced by
    ``uq_hackathon_submission_per_dev``).
    """
    h = _get_hackathon_by_slug(db, slug)
    role = _require_role(db, h.id, user_id, HackathonRoleType.PARTICIPANT.value)
    _validate_github_url(body.github_url)

    # Submission window: scheduled close OR organizer manual lock.
    _require_submissions_open(
        h, code=422, detail="Submissions are closed for this event",
    )

    # Required-extras check
    settings = h.settings_json or {}
    _ensure_extras_complete(body.extras or {}, settings.get("extras_required") or [])

    # Team-size check (if max_team_size set)
    max_team_size = settings.get("max_team_size")
    # Submitter is implicit; team_members is the rest. Total size = 1 + len.
    if max_team_size and (1 + len(body.team_members or [])) > max_team_size:
        raise HTTPException(
            status_code=422,
            detail=f"Team size exceeds max ({max_team_size})",
        )

    # One-submission-per-dev (catch via unique constraint, but pre-check
    # for a clean 409 message)
    existing_sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.hackathon_id == h.id,
        HackathonSubmission.submitter_user_id == user_id,
    ).first()
    if existing_sub is not None:
        raise HTTPException(
            status_code=409,
            detail="You already have a submission for this hackathon",
        )

    # Create / reuse the underlying Project + ProjectAudit
    project, _audit = _create_or_get_project_for_submission(
        db, user_id=user_id, repo_url=body.github_url,
    )

    # Strip submitter from team_members (per contract: "submitter excluded")
    submitter_user = db.query(User).filter(User.id == user_id).first()
    submitter_username = (
        submitter_user.githubUsername if submitter_user else None
    )
    cleaned_team = [
        m.strip() for m in (body.team_members or [])
        if m and m.strip() and m.strip() != submitter_username
    ]

    submission = HackathonSubmission(
        hackathon_id=h.id,
        submitter_user_id=user_id,
        project_id=project.id,
        github_url=body.github_url,
        extras_json=body.extras or {},
        team_members_json=cleaned_team,
        tagline=(body.tagline or "").strip() or None,
        what_it_does=(body.what_it_does or "").strip() or None,
        demo_url=(body.demo_url or "").strip() or None,
        team_name=(body.team_name or "").strip() or None,
        tracks_opted_out_json=[
            t.strip() for t in (body.tracks_opted_out or []) if t and t.strip()
        ],
        submission_status=SubmissionStatus.SUBMITTED.value,
        audit_status=AuditStatus.PENDING.value,
        submitted_at=_now(),
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    # Dispatch the audit. ``hackathon_mode=True`` propagates to reduce_phase.
    background_tasks.add_task(
        _run_v4_for_hackathon_submission,
        str(submission.id),
        str(project.id),
        True,
    )
    log.info(
        "[hackathon] submission=%s queued for hackathon=%s repo=%s",
        submission.id, h.slug, body.github_url,
    )

    return {
        "submission_id": str(submission.id),
        "submission_status": submission.submission_status,
        "audit_status": submission.audit_status,
        "github_url": submission.github_url,
        "team_members": submission.team_members_json,
    }


# ─── Endpoint 5: Update submission ────────────────────────────────────────────

@router.patch("/{slug}/submissions/{submission_id}")
def update_submission(
    slug: str,
    submission_id: str,
    body: UpdateSubmissionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Partial-update a submission before the deadline.

    Only the original submitter may PATCH. Re-triggers the audit if
    ``github_url`` changed; otherwise only updates extras/team.
    """
    try:
        sub_uuid = uuid.UUID(submission_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Submission not found")

    h = _get_hackathon_by_slug(db, slug)
    sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.id == sub_uuid,
        HackathonSubmission.hackathon_id == h.id,
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Edit gate: submitter OR accepted teammate may edit (full-edit policy).
    is_authorized_editor = sub.submitter_user_id == user_id
    if not is_authorized_editor:
        teammate = db.query(HackathonTeamMember).filter(
            HackathonTeamMember.submission_id == sub.id,
            HackathonTeamMember.accepted_user_id == user_id,
            HackathonTeamMember.status == TeamMemberStatus.ACCEPTED.value,
        ).first()
        if teammate is not None:
            is_authorized_editor = True

    if not is_authorized_editor:
        raise HTTPException(
            status_code=403,
            detail="Only the submitter or an accepted teammate can update this submission",
        )

    # Lock gate (scheduled close OR manual override).
    _require_submissions_open(h, code=409)

    settings = h.settings_json or {}
    repo_changed = False

    if body.github_url is not None and body.github_url != sub.github_url:
        _validate_github_url(body.github_url)
        sub.github_url = body.github_url
        repo_changed = True

    if body.extras is not None:
        # Merge with existing extras (partial update). Re-validate required.
        merged = dict(sub.extras_json or {})
        merged.update(body.extras)
        _ensure_extras_complete(merged, settings.get("extras_required") or [])
        sub.extras_json = merged

    if body.team_members is not None:
        max_team_size = settings.get("max_team_size")
        if max_team_size and (1 + len(body.team_members)) > max_team_size:
            raise HTTPException(
                status_code=422,
                detail=f"Team size exceeds max ({max_team_size})",
            )
        submitter_user = db.query(User).filter(User.id == user_id).first()
        submitter_username = (
            submitter_user.githubUsername if submitter_user else None
        )
        sub.team_members_json = [
            m.strip() for m in body.team_members
            if m and m.strip() and m.strip() != submitter_username
        ]

    # First-class fields (2026-05-17). Empty string -> NULL so blanking out
    # in the UI clears the column rather than persisting "".
    if body.tagline is not None:
        sub.tagline = body.tagline.strip() or None
    if body.what_it_does is not None:
        sub.what_it_does = body.what_it_does.strip() or None
    if body.demo_url is not None:
        sub.demo_url = body.demo_url.strip() or None
    if body.team_name is not None:
        sub.team_name = body.team_name.strip() or None
    if body.tracks_opted_out is not None:
        sub.tracks_opted_out_json = [
            t.strip() for t in body.tracks_opted_out if t and t.strip()
        ]

    sub.updated_at = _now()

    if repo_changed:
        # Reset audit + (re)attach a project for the new repo
        project, _audit = _create_or_get_project_for_submission(
            db, user_id=user_id, repo_url=sub.github_url,
        )
        sub.project_id = project.id
        sub.audit_status = AuditStatus.PENDING.value
        sub.audit_error = None
        sub.matched_sponsors_json = {}

    db.commit()
    db.refresh(sub)

    if repo_changed:
        background_tasks.add_task(
            _run_v4_for_hackathon_submission,
            str(sub.id),
            str(sub.project_id),
            True,
        )

    audit = (
        db.query(ProjectAudit).filter(
            ProjectAudit.project_id == sub.project_id,
        ).first()
        if sub.project_id else None
    )
    visible = _score_is_visible_to_submitter(h)
    return _serialize_submission(sub, audit=audit, hackathon=h, score_visible=visible)


# ─── Endpoint 6: Get submission status (polling) ──────────────────────────────

@router.get("/{slug}/submissions/{submission_id}")
def get_submission(
    slug: str,
    submission_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Polling target for the dev's own submission.

    Visible to: submitter, team members (matched by github_username),
    or any organizer/judge in this event.
    """
    try:
        sub_uuid = uuid.UUID(submission_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Submission not found")

    h = _get_hackathon_by_slug(db, slug)
    sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.id == sub_uuid,
        HackathonSubmission.hackathon_id == h.id,
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Authorization: submitter, team-mate, or organizer/judge
    is_submitter = sub.submitter_user_id == user_id
    is_team_member = False
    if not is_submitter:
        user = db.query(User).filter(User.id == user_id).first()
        gh_user = user.githubUsername if user else None
        if gh_user and gh_user in (sub.team_members_json or []):
            is_team_member = True

    is_staff = False
    if not is_submitter and not is_team_member:
        role_row = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == h.id,
            HackathonRole.user_id == user_id,
        ).first()
        if role_row is not None and role_row.role in (
            HackathonRoleType.ORGANIZER.value,
            HackathonRoleType.JUDGE.value,
        ):
            is_staff = True

    if not (is_submitter or is_team_member or is_staff):
        raise HTTPException(status_code=403, detail="Not authorized")

    audit = (
        db.query(ProjectAudit).filter(
            ProjectAudit.project_id == sub.project_id,
        ).first()
        if sub.project_id else None
    )
    # Staff (organizer/judge) always sees the score. Submitters and team
    # members are gated by the event's score-visibility setting.
    visible = is_staff or _score_is_visible_to_submitter(h)
    return _serialize_submission(sub, audit=audit, hackathon=h, score_visible=visible)


# ─── Endpoint 6b: Toggle pin-to-profile ───────────────────────────────────────

class TogglePinRequest(BaseModel):
    pinned: bool


@router.patch("/{slug}/submissions/{submission_id}/pin")
def toggle_pin(
    slug: str,
    submission_id: str,
    body: TogglePinRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Submitter-only — pin/unpin this completed submission to the user's
    public profile. Audit must have completed and not failed; pinning a
    failed/incomplete audit doesn't make sense and is rejected with 422.
    """
    try:
        sub_uuid = uuid.UUID(submission_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Submission not found")

    h = _get_hackathon_by_slug(db, slug)
    sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.id == sub_uuid,
        HackathonSubmission.hackathon_id == h.id,
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.submitter_user_id != user_id:
        raise HTTPException(status_code=403, detail="Only the submitter can pin")

    if body.pinned and sub.audit_status != AuditStatus.COMPLETE.value:
        raise HTTPException(
            status_code=422,
            detail="Can only pin submissions whose audit has completed",
        )

    sub.pinned_to_profile = body.pinned
    sub.updated_at = _now()
    db.commit()
    return {"submission_id": str(sub.id), "pinned_to_profile": sub.pinned_to_profile}


# ─── Endpoint 7: Organizer dashboard — submissions list ───────────────────────

@router.get("/{slug}/admin/submissions")
def list_submissions_admin(
    slug: str,
    audit_status: Optional[str] = Query(default=None),
    sort: str = Query(default="score_desc", pattern="^(score_desc|recent)$"),
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),):
    """Organizer/judge dashboard. Returns every submission with full extras."""
    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id)

    q = db.query(HackathonSubmission).filter(
        HackathonSubmission.hackathon_id == h.id,
    )
    if audit_status:
        q = q.filter(HackathonSubmission.audit_status == audit_status)

    if sort == "recent":
        q = q.order_by(desc(HackathonSubmission.submitted_at))
    # score_desc applied below after we materialize rows + audits

    rows = q.all()

    # Pull the related ProjectAudit + submitter username in batch
    project_ids = [r.project_id for r in rows if r.project_id]
    audits_by_project: dict[uuid.UUID, ProjectAudit] = {}
    if project_ids:
        for a in db.query(ProjectAudit).filter(
            ProjectAudit.project_id.in_(project_ids),
        ).all():
            audits_by_project[a.project_id] = a

    submitter_ids = {r.submitter_user_id for r in rows}
    users_by_id: dict[str, User] = {}
    if submitter_ids:
        for u in db.query(User).filter(User.id.in_(submitter_ids)).all():
            users_by_id[u.id] = u

    payload_list: list[dict[str, Any]] = []
    for r in rows:
        audit = audits_by_project.get(r.project_id) if r.project_id else None
        # Admin/judge dashboard — always show scores regardless of visibility
        # setting. Visibility only gates devs from seeing each other's scores.
        item = _serialize_submission(r, audit=audit, hackathon=h, score_visible=True)
        submitter = users_by_id.get(r.submitter_user_id)
        item["submitter_username"] = (
            submitter.githubUsername if submitter else None
        )
        payload_list.append(item)

    if sort == "score_desc":
        payload_list.sort(
            key=lambda x: (x.get("repo_score") or -1),
            reverse=True,
        )

    # Status counters (over the unfiltered set so the UI dashboard always
    # has the totals)
    counts = dict(
        db.query(
            HackathonSubmission.audit_status,
            func.count(HackathonSubmission.id),
        )
        .filter(HackathonSubmission.hackathon_id == h.id)
        .group_by(HackathonSubmission.audit_status)
        .all()
    )

    return {
        "hackathon_id": str(h.id),
        "submissions": payload_list,
        "total_count": sum(counts.values()),
        "complete_count": int(counts.get(AuditStatus.COMPLETE.value, 0)),
        "running_count": int(
            counts.get(AuditStatus.RUNNING.value, 0)
            + counts.get(AuditStatus.PENDING.value, 0)
        ),
        "failed_count": int(counts.get(AuditStatus.FAILED.value, 0)),
    }


# ─── Endpoint 8: Publish leaderboard ──────────────────────────────────────────

@router.post("/{slug}/publish")
def publish_hackathon(
    slug: str,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),):
    """Flip ``published_at`` so the public leaderboard endpoint becomes
    accessible. Idempotent: re-calls return the existing ``published_at``."""
    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id)

    if h.published_at is None:
        h.published_at = _now()
        db.commit()
        db.refresh(h)

    return {
        "published": True,
        "published_at": _isoformat(h.published_at),
    }


# ─── Endpoint 9: Public leaderboard ───────────────────────────────────────────

@router.get("/{slug}/leaderboard")
def get_leaderboard(
    slug: str,
    db: Session = Depends(get_db),
):
    """Public leaderboard. 404 until the organizer calls /publish."""
    h = _get_hackathon_by_slug(db, slug)
    if h.published_at is None:
        raise HTTPException(status_code=404, detail="Leaderboard is not yet published")

    # Pull all complete submissions + their audit + submitter
    rows = db.query(HackathonSubmission).filter(
        HackathonSubmission.hackathon_id == h.id,
        HackathonSubmission.audit_status == AuditStatus.COMPLETE.value,
        HackathonSubmission.submission_status == SubmissionStatus.SUBMITTED.value,
    ).all()

    project_ids = [r.project_id for r in rows if r.project_id]
    audits_by_project: dict[uuid.UUID, ProjectAudit] = {}
    if project_ids:
        for a in db.query(ProjectAudit).filter(
            ProjectAudit.project_id.in_(project_ids),
        ).all():
            audits_by_project[a.project_id] = a

    submitter_ids = {r.submitter_user_id for r in rows}
    users_by_id: dict[str, User] = {}
    if submitter_ids:
        for u in db.query(User).filter(User.id.in_(submitter_ids)).all():
            users_by_id[u.id] = u

    items: list[dict[str, Any]] = []
    for r in rows:
        audit = audits_by_project.get(r.project_id) if r.project_id else None
        if audit is None or audit.v4_score is None:
            continue
        submitter = users_by_id.get(r.submitter_user_id)
        matched = r.matched_sponsors_json or {}
        opted_out = {
            t.strip().lower()
            for t in (r.tracks_opted_out_json or [])
            if isinstance(t, str) and t.strip()
        }
        items.append({
            "submission_id": str(r.id),
            "submitter_username": (
                submitter.githubUsername if submitter else None
            ),
            "team_name": r.team_name,
            "team_members": r.team_members_json or [],
            "github_url": r.github_url,
            "tagline": r.tagline,
            "repo_score": audit.v4_score,
            "repo_tier": audit.v4_tier,
            "matched_sponsors": {k: len(v) for k, v in matched.items()},
            # Internal use only — stripped from the public payload below.
            "_tracks_opted_out": opted_out,
        })

    items.sort(key=lambda x: x["repo_score"] or 0, reverse=True)
    rankings = [
        {"rank": i + 1, **{k: v for k, v in it.items() if not k.startswith("_")}}
        for i, it in enumerate(items)
    ]

    # Per-sponsor leaderboards. Submissions that opted out of a given
    # sponsor's track are excluded from that sponsor's board (their score
    # still appears on the overall leaderboard unchanged).
    sponsor_boards: dict[str, list[dict[str, Any]]] = {}
    for sponsor in h.sponsors_json or []:
        if not isinstance(sponsor, dict) or not sponsor.get("name"):
            continue
        sname = sponsor["name"]
        sname_low = sname.strip().lower()
        sponsor_items = [
            {
                "submission_id": it["submission_id"],
                "submitter_username": it["submitter_username"],
                "team_name": it["team_name"],
                "github_url": it["github_url"],
                "tagline": it["tagline"],
                "repo_score": it["repo_score"],
                "repo_tier": it["repo_tier"],
                "claim_count": it["matched_sponsors"].get(sname, 0),
            }
            for it in items
            if sname in (it.get("matched_sponsors") or {})
            and sname_low not in it["_tracks_opted_out"]
        ]
        sponsor_items.sort(
            key=lambda x: (x["claim_count"], x["repo_score"] or 0),
            reverse=True,
        )
        if sponsor_items:
            sponsor_boards[sname] = [
                {"rank": i + 1, **it}
                for i, it in enumerate(sponsor_items)
            ]

    return {
        "hackathon_id": str(h.id),
        "name": h.name,
        "published_at": _isoformat(h.published_at),
        "rankings": rankings,
        "sponsor_leaderboards": sponsor_boards,
    }


# ─── Endpoints: Multi-admin team + magic-link invites ─────────────────────────
#
# Replaces the single ``organizer_access_code`` model with proper role rows
# in ``hackathon_role`` plus one-time magic-link invites (``hackathon_invite``).
# Legacy code-paste still works as a fallback so existing events don't break.
#
# Roles:
#   ORGANIZER — full event admin (invite/remove team, publish, settings)
#   JUDGE     — score submissions, see leaderboard
#   OBSERVER  — read-only (sponsors)
#   PARTICIPANT — submit projects (existing flow)

import os as _os  # noqa: E402

_FRONTEND_BASE_URL = _os.environ.get("FRONTEND_BASE_URL", "https://orenda.vision")
_INVITE_DEFAULT_EXPIRES_DAYS = 7


_TEAM_ROLES = {
    HackathonRoleType.ORGANIZER.value,
    HackathonRoleType.JUDGE.value,
    HackathonRoleType.OBSERVER.value,
}


def _serialize_invite(inv: HackathonInvite, slug: str) -> dict[str, Any]:
    """JSON-friendly view of an invite for list endpoints."""
    return {
        "id": str(inv.id),
        "hackathon_id": str(inv.hackathon_id),
        "role": inv.role,
        "invited_email": inv.invited_email,
        "invited_by": inv.invited_by,
        "token": inv.token,
        "magic_link": f"{_FRONTEND_BASE_URL}/hackathons/{slug}/invites/{inv.token}",
        "expires_at": _isoformat(inv.expires_at),
        "used_at": _isoformat(inv.used_at),
        "accepted_by": inv.accepted_by,
        "revoked_at": _isoformat(inv.revoked_at),
        "status": inv.status,
        "created_at": _isoformat(inv.created_at),
    }


class CreateInviteRequest(BaseModel):
    invited_email: Optional[str] = Field(default=None, max_length=255)
    role: str = Field(..., min_length=3, max_length=32)
    expires_in_days: int = Field(default=_INVITE_DEFAULT_EXPIRES_DAYS, ge=1, le=30)

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in _TEAM_ROLES:
            raise ValueError(
                f"role must be one of: {sorted(_TEAM_ROLES)}"
            )
        return v


class ChangeRoleRequest(BaseModel):
    role: str = Field(..., min_length=3, max_length=32)

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in _TEAM_ROLES:
            raise ValueError(
                f"role must be one of: {sorted(_TEAM_ROLES)}"
            )
        return v


@router.post("/{slug}/invites", status_code=201)
def create_invite(
    slug: str,
    body: CreateInviteRequest,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),):
    """Create a magic-link invite for a new team member.

    Returns the full magic link the organizer can share. Token is single-use
    and expires after ``expires_in_days`` (default 7).
    """
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    if not user_id:
        raise HTTPException(
            status_code=400,
            detail="Inviting requires a signed-in organizer (cannot invite via legacy code path)",
        )

    # Generate a token that's effectively impossible to guess.
    token = secrets.token_urlsafe(24)
    while db.query(HackathonInvite).filter(HackathonInvite.token == token).first():
        token = secrets.token_urlsafe(24)

    from datetime import timedelta
    now = datetime.now(timezone.utc)
    # Normalize email to lowercase so downstream comparisons (BetterAuth
    # stores user.email lowercase; the magic-link POST compares them
    # lowercase) match deterministically regardless of how the organizer
    # typed it. Without this, "Alice@Example.com" stored verbatim would
    # fail the no-session-branch lookup and silently break the invite.
    _normalized_email = (body.invited_email or "").strip().lower() or None
    inv = HackathonInvite(
        hackathon_id=h.id,
        invited_email=_normalized_email,
        invited_by=user_id,
        role=body.role,
        token=token,
        expires_at=now + timedelta(days=body.expires_in_days),
        created_at=now,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    log.info(
        "[hackathon-invite] created token=%s hackathon=%s role=%s invited_email=%s by=%s",
        token[:8] + "...", slug, body.role, inv.invited_email, user_id,
    )
    return _serialize_invite(inv, slug)


@router.get("/{slug}/invites")
def list_invites(
    slug: str,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),):
    """List all invites for this hackathon (pending, accepted, revoked, expired)."""
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    rows = db.query(HackathonInvite).filter(
        HackathonInvite.hackathon_id == h.id,
    ).order_by(desc(HackathonInvite.created_at)).all()
    return {"invites": [_serialize_invite(r, slug) for r in rows]}


@router.delete("/{slug}/invites/{invite_id}", status_code=204)
def revoke_invite(
    slug: str,
    invite_id: str,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),):
    """Revoke a pending invite. Already-accepted invites stay accepted —
    revoke the resulting role separately via team management."""
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    try:
        invite_uuid = uuid.UUID(invite_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invite not found")

    inv = db.query(HackathonInvite).filter(
        HackathonInvite.id == invite_uuid,
        HackathonInvite.hackathon_id == h.id,
    ).first()
    if inv is None:
        raise HTTPException(status_code=404, detail="Invite not found")

    if inv.revoked_at is None and inv.used_at is None:
        inv.revoked_at = datetime.now(timezone.utc)
        inv.revoked_by = user_id
        db.commit()
    return None


@router.get("/invites/lookup/{token}")
def lookup_invite(
    token: str,
    db: Session = Depends(get_db),
):
    """Public endpoint — anyone holding the token can look up the invite
    metadata (used by the frontend landing page before the user logs in
    so we can show "You've been invited to manage X as ROLE")."""
    inv = db.query(HackathonInvite).filter(
        HackathonInvite.token == token,
    ).first()
    if inv is None:
        raise HTTPException(status_code=404, detail="Invite not found")

    h = db.query(Hackathon).filter(Hackathon.id == inv.hackathon_id).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Hackathon not found")

    # NOTE: we deliberately do NOT return `invited_email`. Leaked tokens
    # would otherwise reveal the invitee's email + role + event — useful
    # for targeted phishing. The email-binding check lives server-side in
    # accept_invite below.
    return {
        "hackathon": {
            "id": str(h.id),
            "slug": h.slug,
            "name": h.name,
        },
        "role": inv.role,
        "status": inv.status,
        "expires_at": _isoformat(inv.expires_at),
        "email_bound": inv.invited_email is not None,
    }


@router.post("/invites/accept/{token}", status_code=200)
def accept_invite(
    token: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Accept an invite. Creates (or replaces) the hackathon_role row and
    marks the invite used. Must be authenticated.

    If the user already has a role on this hackathon, the existing row is
    updated to the new role (re-invite as promotion/demotion is supported).
    """
    inv = db.query(HackathonInvite).filter(
        HackathonInvite.token == token,
    ).first()
    if inv is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    if not inv.is_active:
        raise HTTPException(
            status_code=410,
            detail=f"Invite is {inv.status}",
        )

    # Email-binding check: if the invite was issued for a specific email,
    # only that email's owner may accept. Without this, anyone holding the
    # token (forwarded email, screenshot, link unfurler cache) could claim
    # the role using their own DevProof account.
    if inv.invited_email is not None:
        caller_row = db.execute(
            sql_text('SELECT email FROM "user" WHERE id = :uid LIMIT 1'),
            {"uid": user_id},
        ).first()
        caller_email = (caller_row[0] if caller_row else None) or ""
        if not caller_email:
            raise HTTPException(
                status_code=403,
                detail=(
                    "This invite is bound to a specific email. Your account "
                    "has no email on file; sign in via GitHub with a verified "
                    "email before accepting."
                ),
            )
        if caller_email.strip().lower() != inv.invited_email.strip().lower():
            raise HTTPException(
                status_code=403,
                detail=(
                    "This invite was issued for a different email. Sign in "
                    "with the invited email address to accept."
                ),
            )

    h = db.query(Hackathon).filter(Hackathon.id == inv.hackathon_id).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Hackathon not found")

    # Upsert hackathon_role for this user
    existing = db.query(HackathonRole).filter(
        HackathonRole.hackathon_id == h.id,
        HackathonRole.user_id == user_id,
    ).first()
    if existing is None:
        db.add(HackathonRole(
            hackathon_id=h.id,
            user_id=user_id,
            role=inv.role,
        ))
    else:
        existing.role = inv.role

    inv.used_at = datetime.now(timezone.utc)
    inv.accepted_by = user_id
    db.commit()

    log.info(
        "[hackathon-invite] accepted token=%s hackathon=%s role=%s user=%s",
        token[:8] + "...", h.slug, inv.role, user_id,
    )

    return {
        "hackathon": {
            "id": str(h.id),
            "slug": h.slug,
            "name": h.name,
        },
        "role": inv.role,
        "redirect_to": f"/hackathons/{h.slug}/admin"
        if inv.role == HackathonRoleType.ORGANIZER.value
        else f"/hackathons/{h.slug}",
    }


@router.get("/{slug}/team")
def list_team(
    slug: str,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),):
    """List current team members (everyone with an organizer/judge/observer role)."""
    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id)

    rows = db.query(HackathonRole).filter(
        HackathonRole.hackathon_id == h.id,
        HackathonRole.role.in_([
            HackathonRoleType.ORGANIZER.value,
            HackathonRoleType.JUDGE.value,
            HackathonRoleType.OBSERVER.value,
        ]),
    ).order_by(HackathonRole.created_at).all()

    user_ids = [r.user_id for r in rows]
    users = (
        db.query(User).filter(User.id.in_(user_ids)).all()
        if user_ids else []
    )
    user_by_id = {u.id: u for u in users}

    team: list[dict[str, Any]] = []
    for r in rows:
        u = user_by_id.get(r.user_id)
        team.append({
            "user_id": r.user_id,
            "username": getattr(u, "githubUsername", None) if u else None,
            "name": getattr(u, "name", None) if u else None,
            "email": getattr(u, "email", None) if u else None,
            "role": r.role,
            "joined_at": _isoformat(r.created_at),
        })
    return {"team": team}


@router.patch("/{slug}/team/{member_user_id}")
def change_member_role(
    slug: str,
    member_user_id: str,
    body: ChangeRoleRequest,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),):
    """Change a team member's role. Organizer-only.

    Prevents the last organizer from demoting themselves (the event would
    end up with no admin)."""
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    row = db.query(HackathonRole).filter(
        HackathonRole.hackathon_id == h.id,
        HackathonRole.user_id == member_user_id,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Team member not found")

    # Guard: don't allow removing the last organizer
    if (
        row.role == HackathonRoleType.ORGANIZER.value
        and body.role != HackathonRoleType.ORGANIZER.value
    ):
        organizer_count = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == h.id,
            HackathonRole.role == HackathonRoleType.ORGANIZER.value,
        ).count()
        if organizer_count <= 1:
            raise HTTPException(
                status_code=409,
                detail="Cannot demote the last organizer — promote someone else first",
            )

    row.role = body.role
    db.commit()
    return {
        "user_id": member_user_id,
        "role": body.role,
    }


@router.delete("/{slug}/team/{member_user_id}", status_code=204)
def remove_member(
    slug: str,
    member_user_id: str,
    db: Session = Depends(get_db),
    user_id: Optional[str] = Depends(_optional_user_id),):
    """Remove a team member. Organizer-only.

    Prevents removing the last organizer (would orphan the event)."""
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    row = db.query(HackathonRole).filter(
        HackathonRole.hackathon_id == h.id,
        HackathonRole.user_id == member_user_id,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Team member not found")

    if row.role == HackathonRoleType.ORGANIZER.value:
        organizer_count = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == h.id,
            HackathonRole.role == HackathonRoleType.ORGANIZER.value,
        ).count()
        if organizer_count <= 1:
            raise HTTPException(
                status_code=409,
                detail="Cannot remove the last organizer — invite someone else first",
            )

    db.delete(row)
    db.commit()
    return None


# ─── Endpoints: Submission team-member invites ────────────────────────────────
#
# Two-tier invitation flow that mirrors hackathon_invite but operates at the
# submission level. A submitter can invite teammates by either DevProof
# username or email. On accept, the invitee:
#
#   1. Becomes an "accepted_user_id" on a hackathon_team_member row, granting
#      full edit rights on the submission.
#   2. Gets a participant role on the hackathon (if not already), so the
#      event surfaces on their /me/hackathons dashboard.
#
# Tokens are single-use, 7-day expiry, revocable. Same security model as
# the existing hackathon_invite endpoints.


def _resolve_invite_target(
    db: Session, identifier: str,
) -> tuple[Optional[str], Optional[str]]:
    """Resolve a free-text identifier into (invited_user_id, invited_email).

    Heuristic: contains "@" -> treat as email; otherwise look up by
    githubUsername. Username lookup is *required* to resolve to a user;
    email lookup is *not* — an unrecognized email becomes a deferred-resolve
    invite the recipient can claim on first sign-in.

    Email values are normalized to lowercase to match BetterAuth's storage
    convention.
    """
    ident = (identifier or "").strip()
    if not ident:
        raise HTTPException(
            status_code=422,
            detail="Teammate identifier (username or email) is required",
        )
    if "@" in ident:
        email = ident.lower()
        # Don't require resolution — email invites work for non-DevProof users.
        existing = db.query(User).filter(User.email == email).first()
        return (existing.id if existing else None, email)

    # Username lookup — case-insensitive on githubUsername.
    user = db.query(User).filter(
        func.lower(User.githubUsername) == ident.lstrip("@").lower(),
    ).first()
    if user is None:
        raise HTTPException(
            status_code=404,
            detail=f"No DevProof user with username '{ident}'. Try inviting by email instead.",
        )
    return (user.id, None)


def _serialize_team_member(
    row: HackathonTeamMember,
    *,
    user: Optional[User] = None,
    hackathon_slug: Optional[str] = None,
) -> dict[str, Any]:
    """Outward shape used by both list + create endpoints."""
    accepted_user_info: Optional[dict[str, Any]] = None
    if user is not None:
        accepted_user_info = {
            "user_id": user.id,
            "username": user.githubUsername,
            "name": user.name,
            "email": user.email,
        }
    return {
        "id": str(row.id),
        "submission_id": str(row.submission_id),
        "invited_user_id": row.invited_user_id,
        "invited_email": row.invited_email,
        "accepted_user_id": row.accepted_user_id,
        "status": row.status,
        "invited_by": row.invited_by,
        "invited_at": _isoformat(row.invited_at),
        "accepted_at": _isoformat(row.accepted_at),
        "declined_at": _isoformat(row.declined_at),
        "revoked_at": _isoformat(row.revoked_at),
        "expires_at": _isoformat(row.expires_at),
        "magic_link": (
            f"{_FRONTEND_BASE_URL}/hackathons/{hackathon_slug}/team-invites/{row.invite_token}"
            if hackathon_slug else None
        ),
        "accepted_user": accepted_user_info,
    }


class TeamInviteCreateRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)


def _load_submission_for_team_op(
    db: Session, slug: str, submission_id: str,
) -> tuple[Hackathon, HackathonSubmission]:
    """Resolve (hackathon, submission) or raise 404."""
    try:
        sub_uuid = uuid.UUID(submission_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Submission not found")
    h = _get_hackathon_by_slug(db, slug)
    sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.id == sub_uuid,
        HackathonSubmission.hackathon_id == h.id,
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return h, sub


@router.post("/{slug}/submissions/{submission_id}/team/invites", status_code=201)
def create_team_invite(
    slug: str,
    submission_id: str,
    body: TeamInviteCreateRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Submitter-only. Invite a teammate by DevProof username or email.

    Returns the invite row including the magic-link URL the submitter can
    copy/share. The frontend may also trigger an automatic email send via
    its own proxy layer when an email identifier is supplied.
    """
    h, sub = _load_submission_for_team_op(db, slug, submission_id)
    if sub.submitter_user_id != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the submitter can invite teammates",
        )
    _require_submissions_open(h, code=409)

    invited_uid, invited_email = _resolve_invite_target(db, body.identifier)
    if invited_uid == user_id:
        raise HTTPException(
            status_code=422,
            detail="You can't invite yourself — you're already on this submission",
        )

    # Block duplicate invites: an existing pending or accepted row for this
    # (submission, target) pair makes a new one pointless. Allow re-invite
    # after decline/revoke/expiry.
    duplicate_q = db.query(HackathonTeamMember).filter(
        HackathonTeamMember.submission_id == sub.id,
        HackathonTeamMember.status.in_([
            TeamMemberStatus.PENDING.value,
            TeamMemberStatus.ACCEPTED.value,
        ]),
    )
    if invited_uid:
        duplicate_q = duplicate_q.filter(
            (HackathonTeamMember.invited_user_id == invited_uid)
            | (HackathonTeamMember.accepted_user_id == invited_uid)
        )
    else:
        duplicate_q = duplicate_q.filter(
            HackathonTeamMember.invited_email == invited_email
        )
    if duplicate_q.first() is not None:
        raise HTTPException(
            status_code=409,
            detail="That user/email already has an active or accepted invite",
        )

    # Optional team size cap (defined per-hackathon settings.max_team_size).
    # Counts: submitter (1) + accepted teammates + pending teammates.
    settings = h.settings_json or {}
    max_team_size = settings.get("max_team_size")
    if max_team_size:
        already = db.query(HackathonTeamMember).filter(
            HackathonTeamMember.submission_id == sub.id,
            HackathonTeamMember.status.in_([
                TeamMemberStatus.PENDING.value,
                TeamMemberStatus.ACCEPTED.value,
            ]),
        ).count()
        if 1 + already + 1 > int(max_team_size):
            raise HTTPException(
                status_code=409,
                detail=f"Inviting would exceed the team-size cap ({max_team_size})",
            )

    # Mint a fresh token (collisions are astronomically unlikely but checked).
    token = secrets.token_urlsafe(24)
    while db.query(HackathonTeamMember).filter(
        HackathonTeamMember.invite_token == token,
    ).first():
        token = secrets.token_urlsafe(24)

    from datetime import timedelta
    now = _now()
    row = HackathonTeamMember(
        submission_id=sub.id,
        invited_user_id=invited_uid,
        invited_email=invited_email,
        invite_token=token,
        status=TeamMemberStatus.PENDING.value,
        invited_by=user_id,
        invited_at=now,
        expires_at=now + timedelta(days=7),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    log.info(
        "[team-invite] created submission=%s identifier=%s token=%s by=%s",
        sub.id, body.identifier, token[:8] + "...", user_id,
    )
    return _serialize_team_member(row, hackathon_slug=slug)


@router.get("/{slug}/submissions/{submission_id}/team")
def list_submission_team(
    slug: str,
    submission_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """List the submission's accepted teammates + pending invites.

    Authorized: submitter, accepted teammates, organizers, and judges.
    Returns the full team-member roster annotated with user info where
    available.
    """
    h, sub = _load_submission_for_team_op(db, slug, submission_id)

    is_authorized = sub.submitter_user_id == user_id
    if not is_authorized:
        teammate = db.query(HackathonTeamMember).filter(
            HackathonTeamMember.submission_id == sub.id,
            HackathonTeamMember.accepted_user_id == user_id,
            HackathonTeamMember.status == TeamMemberStatus.ACCEPTED.value,
        ).first()
        if teammate is not None:
            is_authorized = True
    if not is_authorized:
        staff = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == h.id,
            HackathonRole.user_id == user_id,
            HackathonRole.role.in_([
                HackathonRoleType.ORGANIZER.value,
                HackathonRoleType.JUDGE.value,
            ]),
        ).first()
        if staff is not None:
            is_authorized = True
    if not is_authorized:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to view this submission's team",
        )

    rows = db.query(HackathonTeamMember).filter(
        HackathonTeamMember.submission_id == sub.id,
    ).order_by(HackathonTeamMember.invited_at).all()

    # Batch user lookups so we can render usernames + emails in the UI.
    relevant_user_ids = {
        uid for r in rows
        for uid in (r.invited_user_id, r.accepted_user_id)
        if uid
    }
    relevant_user_ids.add(sub.submitter_user_id)
    user_by_id: dict[str, User] = {}
    if relevant_user_ids:
        for u in db.query(User).filter(User.id.in_(relevant_user_ids)).all():
            user_by_id[u.id] = u

    submitter = user_by_id.get(sub.submitter_user_id)
    return {
        "submission_id": str(sub.id),
        "team_name": sub.team_name,
        "submitter": {
            "user_id": sub.submitter_user_id,
            "username": submitter.githubUsername if submitter else None,
            "name": submitter.name if submitter else None,
            "email": submitter.email if submitter else None,
        },
        "members": [
            _serialize_team_member(
                r,
                user=user_by_id.get(r.accepted_user_id) if r.accepted_user_id else None,
                hackathon_slug=slug,
            )
            for r in rows
        ],
    }


@router.delete(
    "/{slug}/submissions/{submission_id}/team/invites/{invite_id}",
    status_code=204,
)
def revoke_team_invite(
    slug: str,
    submission_id: str,
    invite_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Submitter-only. Revoke a pending invite or remove an accepted
    teammate. The teammate loses edit access; their participant role on the
    hackathon stays (they joined the event independently)."""
    h, sub = _load_submission_for_team_op(db, slug, submission_id)
    if sub.submitter_user_id != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the submitter can manage the team",
        )

    try:
        inv_uuid = uuid.UUID(invite_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Team invite not found")
    row = db.query(HackathonTeamMember).filter(
        HackathonTeamMember.id == inv_uuid,
        HackathonTeamMember.submission_id == sub.id,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Team invite not found")

    if row.status in (TeamMemberStatus.REVOKED.value, TeamMemberStatus.DECLINED.value):
        return None  # idempotent
    row.status = TeamMemberStatus.REVOKED.value
    row.revoked_at = _now()
    db.commit()
    return None


# ─── Public lookup + accept/decline (team-side) ───────────────────────────────

@router.get("/team-invites/lookup/{token}")
def lookup_team_invite(
    token: str,
    db: Session = Depends(get_db),
):
    """Public — used by the team-invite landing page to render context
    BEFORE the recipient has accepted. Returns the hackathon name, the
    submission's tagline + submitter, and the invite status. No edit
    permissions granted by this endpoint."""
    row = db.query(HackathonTeamMember).filter(
        HackathonTeamMember.invite_token == token,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Team invite not found")

    sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.id == row.submission_id,
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    h = db.query(Hackathon).filter(Hackathon.id == sub.hackathon_id).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Hackathon not found")

    submitter = db.query(User).filter(User.id == sub.submitter_user_id).first()
    return {
        "hackathon": {
            "id": str(h.id),
            "slug": h.slug,
            "name": h.name,
        },
        "submission": {
            "id": str(sub.id),
            "tagline": sub.tagline,
            "team_name": sub.team_name,
            "github_url": sub.github_url,
        },
        "submitter": {
            "user_id": sub.submitter_user_id,
            "username": submitter.githubUsername if submitter else None,
            "name": submitter.name if submitter else None,
        },
        "invited_email": row.invited_email,
        "status": row.status,
        "expires_at": _isoformat(row.expires_at),
        "is_active": row.is_active,
    }


@router.post("/team-invites/{token}/accept")
def accept_team_invite(
    token: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Authenticated. Accept a team invite.

    Verifies the active session belongs to the invited identity:
      - Username invite: session user.id must match invited_user_id.
      - Email invite: session user.email (case-insensitive) must match
        invited_email.

    On accept:
      1. Sets accepted_user_id + accepted_at + status=accepted on the team_member row.
      2. Grants a participant role on the hackathon if not already present
         (so the event surfaces on /me/hackathons).
    """
    row = db.query(HackathonTeamMember).filter(
        HackathonTeamMember.invite_token == token,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Team invite not found")
    if not row.is_active:
        raise HTTPException(
            status_code=409,
            detail=f"This invite is {row.status} and can no longer be accepted",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="Unknown session user")

    # Identity check: ensure the right person is accepting.
    if row.invited_user_id is not None:
        if row.invited_user_id != user_id:
            raise HTTPException(
                status_code=403,
                detail="This invite belongs to a different DevProof user",
            )
    elif row.invited_email is not None:
        session_email = (user.email or "").strip().lower()
        target_email = (row.invited_email or "").strip().lower()
        if not session_email or session_email != target_email:
            raise HTTPException(
                status_code=403,
                detail="This invite belongs to a different email address",
            )

    sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.id == row.submission_id,
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    now = _now()
    row.status = TeamMemberStatus.ACCEPTED.value
    row.accepted_user_id = user_id
    row.accepted_at = now

    # Grant participant role if not already present (idempotent).
    existing_role = db.query(HackathonRole).filter(
        HackathonRole.hackathon_id == sub.hackathon_id,
        HackathonRole.user_id == user_id,
    ).first()
    if existing_role is None:
        db.add(HackathonRole(
            hackathon_id=sub.hackathon_id,
            user_id=user_id,
            role=HackathonRoleType.PARTICIPANT.value,
        ))

    db.commit()
    db.refresh(row)
    return _serialize_team_member(row)


@router.post("/team-invites/{token}/decline")
def decline_team_invite(
    token: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Authenticated. Decline a team invite. Same identity gate as accept."""
    row = db.query(HackathonTeamMember).filter(
        HackathonTeamMember.invite_token == token,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Team invite not found")
    if row.status != TeamMemberStatus.PENDING.value:
        return _serialize_team_member(row)  # idempotent for non-pending

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="Unknown session user")
    if row.invited_user_id is not None and row.invited_user_id != user_id:
        raise HTTPException(status_code=403, detail="This invite belongs to a different user")
    if (
        row.invited_user_id is None
        and row.invited_email is not None
        and (user.email or "").strip().lower() != (row.invited_email or "").strip().lower()
    ):
        raise HTTPException(status_code=403, detail="This invite belongs to a different email")

    row.status = TeamMemberStatus.DECLINED.value
    row.declined_at = _now()
    db.commit()
    return _serialize_team_member(row)


@router.get("/admin/mine")
def list_my_admin_hackathons(
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """List hackathons accessible to the current user as an admin.

    Behavior:
      - Platform admins (``user.isPlatformAdmin = TRUE``) see EVERY
        hackathon on the platform. DevProof staff use this to manage
        clients' events.
      - All other users see only the hackathons where they hold an
        ORGANIZER role.

    Drives the ``/hackathons/admin`` dashboard. Also surfaces the
    ``is_platform_admin`` flag so the frontend can render appropriate
    copy/gating.
    """
    is_platform_admin_row = db.execute(
        sql_text('SELECT "isPlatformAdmin" FROM "user" WHERE id = :uid'),
        {"uid": user_id},
    ).first()
    is_platform_admin = bool(is_platform_admin_row and is_platform_admin_row[0])

    if is_platform_admin:
        hackathons = (
            db.query(Hackathon)
            .order_by(desc(Hackathon.created_at))
            .all()
        )
    else:
        role_rows = db.query(HackathonRole).filter(
            HackathonRole.user_id == user_id,
            HackathonRole.role == HackathonRoleType.ORGANIZER.value,
        ).all()
        if not role_rows:
            return {
                "hackathons": [],
                "is_platform_admin": False,
            }
        hackathon_ids = [r.hackathon_id for r in role_rows]
        hackathons = db.query(Hackathon).filter(
            Hackathon.id.in_(hackathon_ids),
        ).order_by(desc(Hackathon.created_at)).all()

    items: list[dict[str, Any]] = []
    for h in hackathons:
        sub_count = db.query(HackathonSubmission).filter(
            HackathonSubmission.hackathon_id == h.id,
            HackathonSubmission.submission_status == SubmissionStatus.SUBMITTED.value,
        ).count()
        team_count = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == h.id,
            HackathonRole.role.in_([
                HackathonRoleType.ORGANIZER.value,
                HackathonRoleType.JUDGE.value,
                HackathonRoleType.OBSERVER.value,
            ]),
        ).count()
        items.append({
            "id": str(h.id),
            "slug": h.slug,
            "name": h.name,
            "starts_at": _isoformat(h.starts_at),
            "ends_at": _isoformat(h.ends_at),
            "published_at": _isoformat(h.published_at),
            "submission_count": sub_count,
            "team_count": team_count,
        })
    return {
        "hackathons": items,
        "is_platform_admin": is_platform_admin,
    }


# ─── Platform-admin: reissue a magic-link invite ──────────────────────────────

@router.post("/{slug}/admin/platform-reissue-invite", status_code=201)
def platform_reissue_invite(
    slug: str,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Mint a fresh magic-link invite for any organizer/judge/observer.

    NARROW endpoint — platform admins only. This is the operator's
    "recover lost session" tool: when an organizer like Elsa loses her
    session (cookie cleared, expired, lost the email), the platform
    admin can issue a new magic link without ever entering the per-event
    admin UI. That keeps submissions private from DevProof staff.

    Body: ``{"email": str, "role": "organizer"|"judge"|"observer",
              "expires_in_days": int (optional, default 14)}``

    Returns: ``{"token": str, "magic_link": str}``.
    """
    if not _is_platform_admin(db, user_id):
        raise HTTPException(
            status_code=403,
            detail="Platform admin required",
        )

    email = (body.get("email") or "").strip().lower()
    role = (body.get("role") or "organizer").strip().lower()
    expires_in_days = int(body.get("expires_in_days") or 14)

    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="email is required")
    if role not in (
        HackathonRoleType.ORGANIZER.value,
        HackathonRoleType.JUDGE.value,
        HackathonRoleType.OBSERVER.value,
    ):
        raise HTTPException(
            status_code=422,
            detail="role must be one of organizer | judge | observer",
        )

    hackathon = _get_hackathon_by_slug(db, slug)

    # Auto-create the user row if missing. The magic-link click is the
    # invitee's email-ownership proof (standard email-magic-link UX, same
    # as Slack/Linear/Notion). The user is created with
    # ``emailVerified=FALSE``; the Next.js magic-link POST handler
    # atomically flips it to TRUE when they accept.
    #
    # Defense against skeleton-user pre-takeover: BetterAuth's
    # ``accountLinking`` is DISABLED (see web-platform/src/lib/auth.ts).
    # With linking off, a future GitHub OAuth sign-in cannot silently
    # merge into the skeleton row — BetterAuth refuses the merge
    # entirely. A user who wants to combine their organizer identity
    # with a developer identity must use the explicit "Link GitHub"
    # flow from /settings.
    user_row = db.execute(
        sql_text('SELECT id FROM "user" WHERE email = :email LIMIT 1'),
        {"email": email},
    ).first()
    if user_row is None:
        new_user_id = secrets.token_urlsafe(16)
        now = datetime.now(timezone.utc)
        db.execute(
            sql_text("""
                INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
                VALUES (:id, :name, :email, FALSE, :now, :now)
            """),
            {
                "id": new_user_id,
                "name": email.split("@")[0],
                "email": email,
                "now": now,
            },
        )

    token = secrets.token_urlsafe(24)
    while db.query(HackathonInvite).filter(HackathonInvite.token == token).first():
        token = secrets.token_urlsafe(24)

    now = datetime.now(timezone.utc)
    invite = HackathonInvite(
        hackathon_id=hackathon.id,
        invited_email=email,
        invited_by=user_id,  # the platform admin issuing the invite
        role=role,
        token=token,
        expires_at=now + timedelta(days=expires_in_days),
        created_at=now,
    )
    db.add(invite)
    db.commit()

    frontend_base = os.environ.get("FRONTEND_BASE_URL", "http://localhost:3000")
    magic_link = f"{frontend_base}/hackathons/{slug}/invites/{token}"

    return {
        "token": token,
        "magic_link": magic_link,
        "expires_at": _isoformat(invite.expires_at),
    }


# ─── Platform-admin: provision a fresh hackathon + organizer in one call ────
#
# UI counterpart to scripts/create_organizer.py. Lets DevProof staff create
# a new hackathon, assign an organizer, and mint the magic-link invite from
# the /hackathons/admin dashboard — without touching the terminal.
#
# Guarded by the platform_admin flag on user. The platform admin never gains
# per-event admin access from this endpoint — the new role row belongs to
# the invited organizer.

# Same alphabet/length as create_organizer.py so codes generated either way
# follow the same human-friendly format.
_PLATFORM_PROVISION_ALPHABET = "ACDEFGHJKMNPQRSTUVWXYZ23456789"


def _generate_short_access_code_db(db: Session, length: int = 6) -> str:
    while True:
        code = "".join(secrets.choice(_PLATFORM_PROVISION_ALPHABET) for _ in range(length))
        if not db.query(Hackathon).filter(Hackathon.access_code == code).first():
            return code


class PlatformProvisionRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: Optional[str] = Field(default=None, max_length=200)
    hackathon_slug: str = Field(min_length=3, max_length=80)
    hackathon_name: str = Field(min_length=1, max_length=200)
    starts_at: Optional[str] = Field(default=None)
    ends_at: Optional[str] = Field(default=None)
    invite_expires_days: int = Field(default=14, ge=1, le=60)

    @field_validator("hackathon_slug")
    @classmethod
    def _check_slug(cls, v: str) -> str:
        v = v.strip().lower()
        if not _SLUG_RE.match(v):
            raise ValueError("slug must be lowercase alphanumeric with hyphens")
        return v


def _parse_iso_or_date(s: Optional[str]) -> Optional[datetime]:
    """Accept YYYY-MM-DD or full ISO; returns UTC-aware datetime."""
    if not s:
        return None
    raw = s.strip()
    try:
        if "T" in raw:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(raw, "%Y-%m-%d")
    except (ValueError, TypeError) as e:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid date '{s}': {e}",
        )
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/platform-admin/check-slug")
def platform_check_slug(
    slug: str = Query(min_length=1, max_length=80),
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Platform-admin-only live slug-availability check.

    Drives the debounced indicator on the "Create hackathon" form so
    users see ``Available`` / ``Already taken`` as they type, instead
    of finding out at submit time via a 409. Cheap read; no writes.

    Returns:
        {
          "slug": "the-input",
          "valid":     bool,   # passes _SLUG_RE format
          "available": bool,   # passes format AND no existing row
          "reason":    str | None  # 'invalid_format' | 'taken' | null
        }
    """
    if not _is_platform_admin(db, user_id):
        raise HTTPException(status_code=403, detail="Platform admin required")

    normalized = slug.strip().lower()
    valid = bool(_SLUG_RE.match(normalized)) and 3 <= len(normalized) <= 80
    if not valid:
        return {
            "slug": normalized,
            "valid": False,
            "available": False,
            "reason": "invalid_format",
        }
    exists = db.query(Hackathon).filter(
        Hackathon.slug == normalized,
    ).first() is not None
    return {
        "slug": normalized,
        "valid": True,
        "available": not exists,
        "reason": "taken" if exists else None,
    }


@router.post("/platform-admin/provision-hackathon", status_code=201)
def platform_provision_hackathon(
    body: PlatformProvisionRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Platform-admin-only. Creates a new hackathon, ensures a user row for
    the organizer's email, grants them the ORGANIZER role, mints a magic-link
    invite, and returns the link the platform admin can copy + send.

    Idempotency: re-running with the same slug returns 409 (slugs are unique).
    Re-running with the same email reuses the existing user row.
    """
    if not _is_platform_admin(db, user_id):
        raise HTTPException(status_code=403, detail="Platform admin required")

    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="email is required")

    starts_at = _parse_iso_or_date(body.starts_at)
    ends_at = _parse_iso_or_date(body.ends_at)
    if starts_at and ends_at and ends_at <= starts_at:
        raise HTTPException(
            status_code=422,
            detail="ends_at must be after starts_at",
        )

    # Slug uniqueness — return 409 rather than letting the DB unique
    # constraint fail with an opaque IntegrityError.
    existing_h = db.query(Hackathon).filter(
        Hackathon.slug == body.hackathon_slug,
    ).first()
    if existing_h is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Slug '{body.hackathon_slug}' is already taken",
        )

    # 1. User upsert. Skeleton row created with emailVerified=FALSE; the
    #    magic-link POST handler atomically flips it to TRUE on acceptance.
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        new_user_id = secrets.token_urlsafe(16)
        now = datetime.now(timezone.utc)
        db.execute(
            sql_text("""
                INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
                VALUES (:id, :name, :email, FALSE, :now, :now)
            """),
            {
                "id": new_user_id,
                "name": body.name or email.split("@")[0],
                "email": email,
                "now": now,
            },
        )
        db.flush()
        user = db.query(User).filter(User.id == new_user_id).first()
        if user is None:  # pragma: no cover - defensive
            raise HTTPException(
                status_code=500,
                detail="User insert succeeded but row could not be re-fetched",
            )

    # 2. Hackathon row. Default submission/judging dates to ends_at so the
    #    UI doesn't display NULL-as-epoch ("submissions closed forever").
    hackathon = Hackathon(
        id=uuid.uuid4(),
        slug=body.hackathon_slug,
        name=body.hackathon_name,
        organizer_user_id=user.id,
        starts_at=starts_at,
        submissions_close_at=ends_at,
        judging_starts_at=ends_at,
        ends_at=ends_at,
        access_code=_generate_short_access_code_db(db),
        organizer_access_code=None,
        settings_json={},
        sponsors_json=[],
        created_at=datetime.now(timezone.utc),
    )
    db.add(hackathon)
    db.flush()

    # 3. Grant ORGANIZER role to the invitee (NOT the platform admin).
    db.add(HackathonRole(
        hackathon_id=hackathon.id,
        user_id=user.id,
        role=HackathonRoleType.ORGANIZER.value,
    ))

    # 4. Magic-link invite. Stored with invited_by=platform_admin so the
    #    audit trail correctly shows who initiated provisioning.
    token = secrets.token_urlsafe(24)
    while db.query(HackathonInvite).filter(HackathonInvite.token == token).first():
        token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    invite = HackathonInvite(
        hackathon_id=hackathon.id,
        invited_email=email,
        invited_by=user_id,  # the platform admin
        role=HackathonRoleType.ORGANIZER.value,
        token=token,
        expires_at=now + timedelta(days=body.invite_expires_days),
        created_at=now,
    )
    db.add(invite)
    db.commit()

    magic_link = f"{_FRONTEND_BASE_URL}/hackathons/{hackathon.slug}/invites/{token}"
    log.info(
        "[platform-provision] hackathon=%s email=%s by=%s token=%s",
        hackathon.slug, email, user_id, token[:8] + "...",
    )

    return {
        "hackathon": {
            "id": str(hackathon.id),
            "slug": hackathon.slug,
            "name": hackathon.name,
            "access_code": hackathon.access_code,
        },
        "organizer": {
            "user_id": user.id,
            "email": email,
            "name": user.name,
        },
        "invite": {
            "token": token,
            "magic_link": magic_link,
            "expires_at": _isoformat(invite.expires_at),
        },
    }


# ─── Judge link + scoring (lightweight, no-auth-required) ────────────────────
#
# Model: one shareable URL per hackathon (hackathon.judge_link_token). Any
# judge holding the URL can score submissions — they type their name once,
# write notes, give a 0-10 score. Designed for sponsors / community judges
# who don't have DevProof accounts.
#
# Threat model: the token IS the credential. Organizers share the link out-
# of-band. Regenerating the token immediately invalidates the previous one.
# All write endpoints are token-gated; nothing escapes a single hackathon.


def _get_hackathon_by_judge_token(db: Session, token: str) -> Hackathon:
    """Resolve a hackathon from its judge_link_token, or 404."""
    h = db.query(Hackathon).filter(
        Hackathon.judge_link_token == token,
    ).first()
    if h is None:
        raise HTTPException(
            status_code=404,
            detail="Judge link is invalid or has been regenerated",
        )
    return h


def _normalize_judge_name(name: str) -> str:
    """Trim + length-cap. Used both at write and uniqueness-lookup time."""
    return (name or "").strip()[:80]


class _JudgeScoreRequest(BaseModel):
    submission_id: str = Field(min_length=1)
    judge_name: str = Field(min_length=1, max_length=80)
    # 0.0 - 5.0 with one decimal. Nullable so a judge can save notes
    # without a score.
    score: Optional[float] = Field(default=None, ge=0.0, le=5.0)
    notes: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("judge_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        return _normalize_judge_name(v)


@router.get("/{slug}/admin/judge-link")
def get_judge_link(
    slug: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Return the current judge-link token + full URL, or nulls if the
    organizer hasn't generated one yet. Admin-tier (organizer/judge/observer)
    so judges can pull the same URL if they need to re-share.
    """
    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id)

    if h.judge_link_token is None:
        return {"judge_link_token": None, "judge_link_url": None}

    frontend_base = os.environ.get("FRONTEND_BASE_URL", "http://localhost:3000")
    return {
        "judge_link_token": h.judge_link_token,
        "judge_link_url": f"{frontend_base}/hackathons/{slug}/judge/{h.judge_link_token}",
    }


@router.post("/{slug}/admin/judge-link/regenerate", status_code=200)
def regenerate_judge_link(
    slug: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Organizer-only. Generates (or rotates) the shareable judge URL.

    Calling this for a hackathon that already has a judge_link_token
    REPLACES it — the previous URL stops working immediately. Use this
    if the link leaks or you need to revoke a specific batch of judges.
    """
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    token = secrets.token_urlsafe(24)
    while db.query(Hackathon).filter(Hackathon.judge_link_token == token).first():
        token = secrets.token_urlsafe(24)

    h.judge_link_token = token
    db.commit()
    db.refresh(h)

    frontend_base = os.environ.get("FRONTEND_BASE_URL", "http://localhost:3000")
    return {
        "judge_link_token": token,
        "judge_link_url": f"{frontend_base}/hackathons/{slug}/judge/{token}",
    }


@router.get("/{slug}/judge/{token}/context")
def judge_context(
    slug: str,
    token: str,
    db: Session = Depends(get_db),
):
    """Token-gated, anonymous. Returns the hackathon meta + every complete
    submission for judges to score. No DevProof account required — the
    token in the URL is the only credential needed.
    """
    h = _get_hackathon_by_slug(db, slug)
    if h.judge_link_token is None or h.judge_link_token != token:
        raise HTTPException(
            status_code=404,
            detail="Judge link is invalid or has been regenerated",
        )

    submissions = db.query(HackathonSubmission).filter(
        HackathonSubmission.hackathon_id == h.id,
        HackathonSubmission.submission_status == SubmissionStatus.SUBMITTED.value,
    ).order_by(desc(HackathonSubmission.submitted_at)).all()

    sub_payload: list[dict[str, Any]] = []
    for s in submissions:
        audit = None
        score = None
        tier = None
        if s.project_id is not None:
            pa = db.query(ProjectAudit).filter(
                ProjectAudit.project_id == s.project_id,
            ).first()
            if pa is not None:
                audit = pa
                score = pa.v4_score if hasattr(pa, "v4_score") else None
                tier = pa.v4_tier if hasattr(pa, "v4_tier") else None

        sub_payload.append({
            "submission_id": str(s.id),
            "submitter_user_id": s.submitter_user_id,
            "github_url": s.github_url,
            "team_members": s.team_members_json or [],
            "extras": s.extras_json or {},
            "matched_sponsors": s.matched_sponsors_json or {},
            "audit_status": s.audit_status,
            "audit_error": s.audit_error,
            "repo_score": score,
            "repo_tier": tier,
            "submitted_at": _isoformat(s.submitted_at),
        })

    return {
        "hackathon": {
            "slug": h.slug,
            "name": h.name,
            "submissions_close_at": _isoformat(h.submissions_close_at),
            "ends_at": _isoformat(h.ends_at),
        },
        "submissions": sub_payload,
    }


@router.get("/{slug}/judge/{token}/scores")
def judge_my_scores(
    slug: str,
    token: str,
    judge_name: str,
    db: Session = Depends(get_db),
):
    """Token-gated. Returns the scores + notes the given judge_name has
    already saved, so the judge UI can restore them when the page reloads.
    Case-insensitive lookup so 'Alice' and 'alice' return the same rows.
    """
    h = _get_hackathon_by_slug(db, slug)
    if h.judge_link_token is None or h.judge_link_token != token:
        raise HTTPException(status_code=404, detail="Judge link invalid")

    name = _normalize_judge_name(judge_name)
    if not name:
        return {"scores": []}

    rows = db.query(HackathonJudgeScore).filter(
        HackathonJudgeScore.hackathon_id == h.id,
        func.lower(HackathonJudgeScore.judge_name) == name.lower(),
    ).all()

    return {
        "scores": [
            {
                "submission_id": str(r.submission_id),
                "score": float(r.score) if r.score is not None else None,
                "notes": r.notes or "",
                "updated_at": _isoformat(r.updated_at),
            }
            for r in rows
        ],
    }


@router.post("/{slug}/judge/{token}/score", status_code=200)
def submit_judge_score(
    slug: str,
    token: str,
    body: _JudgeScoreRequest,
    db: Session = Depends(get_db),
):
    """Token-gated. Upsert a (submission, judge_name) score+notes row.

    The same judge can call this repeatedly to edit their entry — the
    UNIQUE (submission_id, judge_name) constraint causes the update to
    land on the existing row rather than creating a duplicate.
    """
    h = _get_hackathon_by_slug(db, slug)
    if h.judge_link_token is None or h.judge_link_token != token:
        raise HTTPException(status_code=404, detail="Judge link invalid")

    # Validate submission belongs to this hackathon.
    sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.id == body.submission_id,
        HackathonSubmission.hackathon_id == h.id,
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    judge_name = _normalize_judge_name(body.judge_name)
    if not judge_name:
        raise HTTPException(status_code=422, detail="judge_name is required")

    now = datetime.now(timezone.utc)
    existing = db.query(HackathonJudgeScore).filter(
        HackathonJudgeScore.submission_id == sub.id,
        func.lower(HackathonJudgeScore.judge_name) == judge_name.lower(),
    ).first()

    if existing is None:
        row = HackathonJudgeScore(
            hackathon_id=h.id,
            submission_id=sub.id,
            judge_name=judge_name,
            score=body.score,
            notes=(body.notes or "").strip() or None,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        existing.score = body.score
        existing.notes = (body.notes or "").strip() or None
        # Keep their original casing if they kept the same name, but normalize
        # to whatever they typed this time (in case of trim/case changes).
        existing.judge_name = judge_name
        existing.updated_at = now
        row = existing

    db.commit()
    db.refresh(row)

    return {
        "id": str(row.id),
        "submission_id": str(row.submission_id),
        "judge_name": row.judge_name,
        "score": float(row.score) if row.score is not None else None,
        "notes": row.notes or "",
        "updated_at": _isoformat(row.updated_at),
    }


@router.get("/{slug}/admin/submissions/{submission_id}/full")
def admin_submission_full(
    slug: str,
    submission_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Admin/judge-tier full audit detail for one submission.

    Returns the same V4 output JSON the dev-side renders via
    ProjectDetailPanel, plus sponsor-evidence enrichment when the
    organizer has flipped ``settings.show_sponsor_evidence`` on.

    Pure read-side: no audit re-runs, no algo touching. See
    app/services/hackathon_audit_view.py for the assembly logic.
    """
    from app.services.hackathon_audit_view import build_admin_submission_view

    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id)

    sub = db.query(HackathonSubmission).filter(
        HackathonSubmission.id == submission_id,
        HackathonSubmission.hackathon_id == h.id,
    ).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    audit = None
    if sub.project_id is not None:
        audit = db.query(ProjectAudit).filter(
            ProjectAudit.project_id == sub.project_id,
        ).first()

    return build_admin_submission_view(submission=sub, audit=audit, hackathon=h)


@router.get("/{slug}/admin/sponsors")
def admin_get_sponsors(
    slug: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Organizer/judge-tier. Returns the full sponsor configuration (with
    packages, which the public endpoint strips). Used by the admin UI to
    populate the sponsor editor.
    """
    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id)
    return {"sponsors": h.sponsors_json or []}


@router.put("/{slug}/admin/sponsors", status_code=200)
def admin_replace_sponsors(
    slug: str,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Organizer-only. Replaces the full sponsor list. Body:
    ``{"sponsors": [{"name": "...", "packages": ["..."], "prize": "..."}, ...]}``.

    Idempotent and full-replace (not merge) — keeps the UI logic dead
    simple. Validates each entry via the SponsorIn Pydantic model.
    """
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    raw = body.get("sponsors")
    if not isinstance(raw, list):
        raise HTTPException(
            status_code=422,
            detail="sponsors must be a list",
        )

    # Validate each entry — surfaces a useful 422 if a row is malformed.
    validated: list[dict[str, Any]] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=422,
                detail=f"sponsors[{i}] must be an object",
            )
        try:
            s = SponsorIn(**item)
        except Exception as e:  # pragma: no cover - Pydantic surfaces messages
            raise HTTPException(
                status_code=422,
                detail=f"sponsors[{i}] invalid: {e}",
            )
        validated.append(s.model_dump())

    h.sponsors_json = validated
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(h, "sponsors_json")
    db.commit()

    return {"sponsors": validated}


@router.patch("/{slug}/admin/settings/sponsor-evidence", status_code=200)
def admin_set_sponsor_evidence(
    slug: str,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Organizer-only. Flip the per-hackathon ``show_sponsor_evidence``
    toggle stored in ``settings_json``. When true, the admin submission
    detail view includes per-sponsor file:line evidence. Default false.

    Body: ``{"show_sponsor_evidence": bool}``.
    """
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    val = body.get("show_sponsor_evidence")
    if not isinstance(val, bool):
        raise HTTPException(
            status_code=422,
            detail="show_sponsor_evidence must be a boolean",
        )

    settings = dict(h.settings_json or {})
    settings["show_sponsor_evidence"] = val
    h.settings_json = settings
    # SQLAlchemy doesn't auto-detect mutations on JSON fields; mark dirty.
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(h, "settings_json")
    db.commit()

    return {"show_sponsor_evidence": val}


@router.patch("/{slug}/admin/settings/submission-lock", status_code=200)
def admin_set_submission_lock(
    slug: str,
    body: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Organizer-only. Two-in-one: flip the manual ``submissions_locked_override``
    toggle and/or update the scheduled ``submissions_close_at`` datetime.

    Either field may be omitted to leave it unchanged. ``submissions_close_at``
    can be set to ``null`` explicitly to clear the scheduled close.

    Body:
        {"locked_override": true | false,
         "submissions_close_at": "2026-06-01T17:00:00Z" | null}
    """
    h = _get_hackathon_by_slug(db, slug)
    _require_organizer(db, h, user_id)

    if "locked_override" in body:
        val = body["locked_override"]
        if not isinstance(val, bool):
            raise HTTPException(
                status_code=422,
                detail="locked_override must be a boolean",
            )
        h.submissions_locked_override = val

    if "submissions_close_at" in body:
        raw = body["submissions_close_at"]
        if raw is None:
            h.submissions_close_at = None
        else:
            if not isinstance(raw, str):
                raise HTTPException(
                    status_code=422,
                    detail="submissions_close_at must be an ISO datetime string or null",
                )
            try:
                # fromisoformat handles "+00:00"; common Z-suffix is normalized.
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail="submissions_close_at must be a valid ISO datetime",
                )
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            h.submissions_close_at = parsed

    db.commit()

    return {
        "locked_override": bool(h.submissions_locked_override),
        "submissions_close_at": _isoformat(h.submissions_close_at),
        "submissions_locked_effective": _submissions_are_locked(h),
    }


@router.get("/{slug}/admin/judge-scores")
def admin_judge_scores(
    slug: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(_current_user_id),
):
    """Organizer/judge-only aggregation. Returns every judge's scores for
    every submission. Used by the admin dashboard to compute averages and
    show per-judge breakdowns.
    """
    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id)

    rows = db.query(HackathonJudgeScore).filter(
        HackathonJudgeScore.hackathon_id == h.id,
    ).order_by(HackathonJudgeScore.submission_id, HackathonJudgeScore.judge_name).all()

    by_submission: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        sid = str(r.submission_id)
        by_submission.setdefault(sid, []).append({
            "judge_name": r.judge_name,
            "score": float(r.score) if r.score is not None else None,
            "notes": r.notes or "",
            "updated_at": _isoformat(r.updated_at),
        })

    summary: dict[str, dict[str, Any]] = {}
    for sid, judges in by_submission.items():
        scored = [j["score"] for j in judges if j["score"] is not None]
        summary[sid] = {
            "judge_count": len(judges),
            "scored_count": len(scored),
            "avg_score": (sum(scored) / len(scored)) if scored else None,
            "judges": judges,
        }

    return {
        "by_submission": summary,
        "judge_link_set": h.judge_link_token is not None,
    }
