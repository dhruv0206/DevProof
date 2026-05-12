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
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Query,
)
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.hackathon import (
    AuditStatus,
    Hackathon,
    HackathonRole,
    HackathonRoleType,
    HackathonSubmission,
    SubmissionStatus,
)
from app.models.project import Project, ProjectAudit
from app.models.user import User
from app.services.v4_shadow_runner import run_v4_cached

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hackathons", tags=["hackathons"])


# ─── Auth helpers ─────────────────────────────────────────────────────────────

def _current_user_id(
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> str:
    """Resolve the authenticated user-id from the X-User-Id header.

    BetterAuth runs in the Next.js layer; the server-side proxy forwards
    the resolved user-id as ``X-User-Id`` (same as ``users.py`` /
    ``profile.py``). Missing header => 401.
    """
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return x_user_id


def _optional_user_id(
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> Optional[str]:
    """Like ``_current_user_id`` but returns ``None`` for anonymous callers
    instead of raising. Used by the public event-fetch endpoint.
    """
    return x_user_id or None


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


def _require_admin_access(
    db: Session,
    hackathon: Hackathon,
    user_id: Optional[str],
    admin_code: Optional[str],
) -> str:
    """Admin-tier access check accepting either GitHub-authed organizer/judge
    role OR a valid ``organizer_access_code`` paste.

    Returns a string label for audit logs: ``"role:<role>"`` or ``"code"``.
    Raises 403 otherwise.
    """
    # Path A: GitHub-authed user with organizer/judge role
    if user_id:
        role = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == hackathon.id,
            HackathonRole.user_id == user_id,
        ).first()
        if role is not None and role.role in (
            HackathonRoleType.ORGANIZER.value,
            HackathonRoleType.JUDGE.value,
        ):
            return f"role:{role.role}"

    # Path B: organizer access code
    if admin_code and hackathon.organizer_access_code:
        if secrets.compare_digest(admin_code, hackathon.organizer_access_code):
            return "code"

    raise HTTPException(
        status_code=403,
        detail="Admin access required (sign in as organizer or paste the admin code)",
    )


def _get_hackathon_by_slug(db: Session, slug: str) -> Hackathon:
    h = db.query(Hackathon).filter(Hackathon.slug == slug).first()
    if h is None:
        raise HTTPException(status_code=404, detail="Hackathon not found")
    return h


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

    # Compute sponsor matches against the sponsor config
    sponsor_match: dict[str, list[str]] = {}
    try:
        # Lazy import to avoid pulling the ranking algo on cold start
        from devproof_ranking_algo.schema.v4_output import V4Output
        from devproof_ranking_algo.v4.sponsor_matcher import match_sponsors

        # Rehydrate V4Output so claim.sdk_packages_used is the real list[str]
        v4_obj = V4Output.model_validate(v4_out)
        sponsor_match = match_sponsors(v4_obj.claims, sponsors_config)
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


class UpdateSubmissionRequest(BaseModel):
    github_url: Optional[str] = Field(default=None, min_length=10, max_length=500)
    extras: Optional[dict[str, Any]] = None
    team_members: Optional[list[str]] = None


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
        organizer_access_code=_generate_access_code(),
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
        "organizer_access_code": hackathon.organizer_access_code,
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
    if not role_rows:
        return {"events": []}

    hackathon_ids = [r.hackathon_id for r in role_rows]
    role_by_hid = {r.hackathon_id: r.role for r in role_rows}

    hackathons = db.query(Hackathon).filter(Hackathon.id.in_(hackathon_ids)).all()

    # Pull this user's submission per event (if any)
    sub_rows = db.query(HackathonSubmission).filter(
        HackathonSubmission.hackathon_id.in_(hackathon_ids),
        HackathonSubmission.submitter_user_id == user_id,
    ).all()
    sub_by_hid = {s.hackathon_id: s for s in sub_rows}

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
    if user_id:
        role_row = db.query(HackathonRole).filter(
            HackathonRole.hackathon_id == h.id,
            HackathonRole.user_id == user_id,
        ).first()
        if role_row is not None:
            your_role = role_row.role

        sub_row = db.query(HackathonSubmission).filter(
            HackathonSubmission.hackathon_id == h.id,
            HackathonSubmission.submitter_user_id == user_id,
        ).first()
        if sub_row is not None:
            your_submission_id = str(sub_row.id)

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
    return {
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
    }


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


# ─── Endpoint 3b: Validate organizer admin code ───────────────────────────────

class AdminAuthRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)


@router.post("/{slug}/admin-auth")
def admin_auth(
    slug: str,
    body: AdminAuthRequest,
    db: Session = Depends(get_db),
):
    """Validate a pasted organizer admin code. Returns 200 on match — the
    Next.js layer is responsible for setting an httpOnly cookie that the
    browser then forwards as ``X-Hackathon-Admin-Code`` on subsequent admin
    requests. Returns 403 on mismatch.
    """
    h = _get_hackathon_by_slug(db, slug)
    if not h.organizer_access_code or not secrets.compare_digest(
        body.code, h.organizer_access_code,
    ):
        raise HTTPException(status_code=403, detail="Invalid admin code")
    return {"ok": True, "hackathon_id": str(h.id), "slug": h.slug}


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

    # Deadline check
    if h.submissions_close_at is not None:
        deadline = h.submissions_close_at
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        if _now() > deadline:
            raise HTTPException(
                status_code=422,
                detail="Submissions are closed for this event",
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

    if sub.submitter_user_id != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the submitter can update this submission",
        )

    # Deadline lock
    if h.submissions_close_at is not None:
        deadline = h.submissions_close_at
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        if _now() > deadline:
            raise HTTPException(
                status_code=409,
                detail="Submissions are locked — deadline has passed",
            )

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
    user_id: Optional[str] = Depends(_optional_user_id),
    x_admin_code: Optional[str] = Header(default=None, alias="X-Hackathon-Admin-Code"),
):
    """Organizer/judge dashboard. Returns every submission with full extras."""
    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id, x_admin_code)

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
    user_id: Optional[str] = Depends(_optional_user_id),
    x_admin_code: Optional[str] = Header(default=None, alias="X-Hackathon-Admin-Code"),
):
    """Flip ``published_at`` so the public leaderboard endpoint becomes
    accessible. Idempotent: re-calls return the existing ``published_at``."""
    h = _get_hackathon_by_slug(db, slug)
    _require_admin_access(db, h, user_id, x_admin_code)

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
        items.append({
            "submission_id": str(r.id),
            "submitter_username": (
                submitter.githubUsername if submitter else None
            ),
            "team_members": r.team_members_json or [],
            "github_url": r.github_url,
            "repo_score": audit.v4_score,
            "repo_tier": audit.v4_tier,
            "matched_sponsors": {k: len(v) for k, v in matched.items()},
        })

    items.sort(key=lambda x: x["repo_score"] or 0, reverse=True)
    rankings = [{"rank": i + 1, **it} for i, it in enumerate(items)]

    # Per-sponsor leaderboards
    sponsor_boards: dict[str, list[dict[str, Any]]] = {}
    for sponsor in h.sponsors_json or []:
        if not isinstance(sponsor, dict) or not sponsor.get("name"):
            continue
        sname = sponsor["name"]
        sponsor_items = [
            {
                "submission_id": it["submission_id"],
                "submitter_username": it["submitter_username"],
                "github_url": it["github_url"],
                "repo_score": it["repo_score"],
                "repo_tier": it["repo_tier"],
                "claim_count": it["matched_sponsors"].get(sname, 0),
            }
            for it in items
            if sname in (it.get("matched_sponsors") or {})
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
