from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from functools import lru_cache
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel, Field
from app.database import SessionLocal, get_db
from app.models.project import Project, ProjectAudit, TechTag, TagCategory
from app.models.user import User
from app.models.audit_cache import AuditCache
from app.models.audit_v4_shadow import AuditV4Shadow
from app.services.cache_service import AuditCacheService, get_repo_code_hash
from app.services.v4_shadow_runner import run_v4, run_v4_cached, run_v4_with_variance
from app.middleware.rate_limit import scan_limiter, audit_limiter
from app.config import get_settings
from devproof_ranking_algo import AuditService
import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timezone

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])

@lru_cache()
def get_audit_service() -> AuditService:
    return AuditService()

class ImportRequest(BaseModel):
    repo_url: str
    user_id: str # In real auth, get from Token
    project_type: str = "Fullstack"
    target_claims: list[str] = None
    # github_username: str | None = None # REMOVED: We fetch this from DB for security

@router.post("/scan")
async def scan_project(
    req: ImportRequest, 
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Step 1: Pre-Scan.
    Returns: Stack info + Authorship stats.
    Does NOT run full audit.
    """
    try:
        # 0. Security: Get the real GitHub username
        user = db.query(User).filter(User.id == req.user_id).first()
        applicant_username = user.githubUsername if user else None
        
        # scan_repo is synchronous logic (GitHub API), but run in threadpool by FastAPI default if not async def
        # However, we made scan_repo synchronous in service.
        return await audit_service.scan_repo(req.repo_url, req.user_id, applicant_username)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/extract-features")
async def extract_features(
    req: ImportRequest,
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Step 1.5: Extract claims from README.
    Returns: { "features": ["Claim 1", "Claim 2"] }
    """
    try:
        features = await audit_service.extract_claims_from_readme(req.repo_url)
        return {"features": features}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# V4 tier → V3 tier label, so UI components that still read complexity_tier
# (dashboards, legacy cards) keep working during the transition.
_V4_TO_V3_TIER = {
    "TIER_3_DEEP": "ELITE",
    "TIER_2_LOGIC": "ADVANCED",
    "TIER_1_UI": "INTERMEDIATE",
}


def _run_v4_primary_background(
    project_audit_id: str,
    project_id: str,
    repo_url: str,
    applicant_username: str | None,
    variance_samples: int = 1,
) -> None:
    """Background task: run V4 and populate Project + ProjectAudit.

    This is the PRIMARY audit path as of the V3→V4 flip. ``/import`` creates
    empty Project+Audit rows and returns ``status: pending`` immediately;
    this task fills them in. Frontend polls ``/status/{project_id}`` until
    v4_ready flips true.

    ``variance_samples`` controls LLM-variance dampening. When > 1, we run
    the pipeline that many times in parallel via ``run_v4_with_variance``
    and return the median score + confidence label. Used for paid-tier
    audits where ±15pt LLM swings are unacceptable. Set globally via the
    ``V4_DEFAULT_VARIANCE_SAMPLES`` env var (default 1 = free tier, no
    dampening; 3 = standard paid tier).

    On success:
    - Project: is_verified=True, verification_status=VERIFIED, authorship_percent
    - ProjectAudit: v4_* fields + legacy fields (tds_score etc.) mapped from V4
    - TechTag rows created from the V4-detected stack
    - AuditV4Shadow row for observability (kept during transition)

    On failure (V4 raised, returned succeeded=False, or low authorship):
    - Project.verification_status=REJECTED so frontend can surface a message
    """
    if SessionLocal is None:
        log.warning("[v4-bg] no DB session available, skipping")
        return

    try:
        if variance_samples > 1:
            log.info(
                "[v4-bg] variance mode: running %d samples for %s",
                variance_samples, repo_url,
            )
            payload = asyncio.run(
                run_v4_with_variance(
                    repo_url,
                    github_username=applicant_username,
                    db_session_factory=SessionLocal,
                    samples=variance_samples,
                    run_full_pipeline=True,
                    enable_verify=False,
                )
            )
        else:
            payload = asyncio.run(
                run_v4_cached(
                    repo_url,
                    github_username=applicant_username,
                    db_session_factory=SessionLocal,
                    run_full_pipeline=True,
                    enable_verify=False,
                )
            )
    except Exception as e:  # noqa: BLE001 — ultimate belt-and-braces
        log.error("[v4-bg] V4 pipeline raised: %s", e)
        _mark_project_rejected(project_id, f"pipeline error: {e}")
        return

    session = SessionLocal()
    try:
        # Observability row (kept during transition; safe to remove later)
        session.add(AuditV4Shadow(
            project_audit_id=uuid.UUID(project_audit_id) if project_audit_id else None,
            repo_url=repo_url,
            commit_sha=payload.get("commit_sha"),
            applicant_username=applicant_username,
            v4_output=payload,
            latency_ms=payload.get("latency_ms"),
            errors=payload.get("errors"),
            pipeline_version=payload.get("pipeline_version", "v4-phase3"),
            succeeded=1 if payload.get("succeeded") else 0,
        ))

        succeeded = payload.get("succeeded")
        v4_out = payload.get("v4_output") or {}

        if not succeeded or not v4_out:
            # V4 ran but didn't produce a usable output — reject cleanly so
            # the polling UI surfaces a specific error rather than hanging.
            project_row = session.query(Project).filter(
                Project.id == uuid.UUID(project_id),
            ).first()
            if project_row is not None:
                project_row.verification_status = "REJECTED"
            session.commit()
            log.warning("[v4-bg] V4 produced no output for project_id=%s", project_id)
            return

        # ── Success path ───────────────────────────────────────────────────
        audit_row = session.query(ProjectAudit).filter(
            ProjectAudit.id == uuid.UUID(project_audit_id),
        ).first()
        if audit_row is None:
            log.error("[v4-bg] audit_row missing for id=%s", project_audit_id)
            session.commit()
            return

        # V4 fields — the source of truth going forward
        audit_row.v4_score = v4_out.get("repo_score")
        audit_row.v4_tier = v4_out.get("repo_tier")
        audit_row.v4_output = v4_out
        audit_row.v4_audited_at = datetime.now(timezone.utc)

        # Legacy/V3-shape mirrors — so unmigrated UI surfaces still render.
        # Can be removed once every reader preferences V4 (step 7 cleanup).
        audit_row.tds_score = v4_out.get("repo_score")
        audit_row.complexity_tier = _V4_TO_V3_TIER.get(
            v4_out.get("repo_tier"), "BASIC",
        )
        audit_row.audit_report = {
            "score_breakdown": {
                "feature_score": v4_out.get("score_breakdown", {}).get("features", {}).get("score"),
                "architecture_score": v4_out.get("score_breakdown", {}).get("architecture", {}).get("score"),
                "intent_score": v4_out.get("score_breakdown", {}).get("intent_and_standards", {}).get("score"),
                "forensics_score": v4_out.get("score_breakdown", {}).get("forensics", {}).get("score"),
            },
            "claims": [
                {
                    "feature": c.get("feature"),
                    "status": "VERIFIED",
                    "tier": c.get("tier"),
                    "tier_reasoning": c.get("tier_reasoning"),
                    "evidence_file": (c.get("evidence") or [{}])[0].get("file"),
                    "feature_type": c.get("feature_type"),
                    "evidence": c.get("evidence", []),
                }
                for c in (v4_out.get("claims") or [])
            ],
        }
        audit_row.discipline = v4_out.get("discipline")
        audit_row.scoring_version = 4
        audit_row.forensics_data = v4_out.get("forensics")

        # Project row: flip to verified + set authorship
        project_row = session.query(Project).filter(
            Project.id == uuid.UUID(project_id),
        ).first()
        if project_row is not None:
            project_row.is_verified = True
            project_row.verification_status = "VERIFIED"
            project_row.authorship_percent = v4_out.get("authorship_percent") or 0.0

            # TechTag rows — purge any stale ones, then (re)insert from V4
            session.query(TechTag).filter(TechTag.project_id == project_row.id).delete()
            stack = v4_out.get("stack") or {}
            for lang in stack.get("languages") or []:
                session.add(TechTag(project_id=project_row.id, name=lang, category=TagCategory.LANGUAGE))
            for fw in stack.get("frameworks") or []:
                session.add(TechTag(project_id=project_row.id, name=fw, category=TagCategory.FRAMEWORK))
            for lib in stack.get("libs") or []:
                session.add(TechTag(project_id=project_row.id, name=lib, category=TagCategory.LIBRARY))

        session.commit()
        log.info(
            "[v4-bg] V4 completed for project_id=%s score=%s tier=%s",
            project_id, v4_out.get("repo_score"), v4_out.get("repo_tier"),
        )
    except Exception as e:  # noqa: BLE001
        log.error("[v4-bg] DB write failed: %s", e)
        session.rollback()
        _mark_project_rejected(project_id, f"db error: {e}")
    finally:
        session.close()


def _mark_project_rejected(project_id: str, reason: str) -> None:
    """Best-effort mark a pending project as rejected. Silent on errors."""
    if SessionLocal is None:
        return
    session = SessionLocal()
    try:
        row = session.query(Project).filter(
            Project.id == uuid.UUID(project_id),
        ).first()
        if row is not None:
            row.verification_status = "REJECTED"
            session.commit()
            log.warning("[v4-bg] marked project_id=%s REJECTED: %s", project_id, reason)
    except Exception as e:  # noqa: BLE001
        log.error("[v4-bg] _mark_project_rejected failed: %s", e)
        session.rollback()
    finally:
        session.close()


def _check_repo_accessibility(repo_url: str) -> tuple[bool, str | None]:
    """Quick pre-check: is the repo accessible to our backend's GitHub token?

    Returns ``(accessible, error_code)`` where ``error_code`` is one of:
    - ``"private_repo_no_access"`` — repo exists but is private (or visibility
      requires a token scope we don't have)
    - ``"repo_not_found"`` — URL points to nothing (typo, deleted, never existed)
    - ``"repo_check_failed"`` — network or rate-limit issue; let the audit try
    - ``None`` — repo is public and accessible
    """
    import re
    from devproof_ranking_algo.ingestor import GithubIngestor

    m = re.search(r"github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$", repo_url)
    if not m:
        return False, "invalid_url"
    owner, name = m.group(1), m.group(2)

    try:
        ingestor = GithubIngestor()
    except Exception as e:  # noqa: BLE001
        log.warning("[import-precheck] GithubIngestor init failed: %s", e)
        return True, None  # let the audit try; don't block on infra issues

    try:
        repo = ingestor.g.get_repo(f"{owner}/{name}")
        # If we can read the repo and it's not private — green light.
        if getattr(repo, "private", False):
            return False, "private_repo_no_access"
        return True, None
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        # PyGithub raises GithubException with status code; check the message.
        if "404" in msg or "not found" in msg:
            # 404 from GitHub on an unauth/insufficient-scope token returns
            # the same code for both "doesn't exist" and "private without
            # access" — we can't distinguish. Default to the access path
            # since that's the more common case for a user trying to import.
            return False, "private_repo_no_access"
        if "403" in msg or "forbidden" in msg:
            return False, "private_repo_no_access"
        log.warning("[import-precheck] unexpected error checking %s: %s", repo_url, e)
        return True, None  # fail open — let the audit try


_PRIVATE_REPO_ERROR_DETAIL = {
    "error_code": "private_repo_no_access",
    "title": "We can't access this repository",
    "message": (
        "This repo appears to be private — or it doesn't exist on GitHub. "
        "DevProof currently only audits public repos. To audit a private "
        "repo, we'd need broader GitHub permissions; visit Settings → "
        "GitHub Access to grant repo-read access (coming soon)."
    ),
    "fix_action": "grant_repo_scope",
}


@router.post("/import")
async def import_project(
    req: ImportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Start a V4 audit. Returns immediately with a project_id; frontend polls
    ``/status/{project_id}`` until V4 completes.

    This is V4-primary — no V3 runs on /import. Authorship gating and score
    computation happen inside the V4 pipeline itself.
    """
    # 0. Security: Get the real GitHub username of the applicant
    user = db.query(User).filter(User.id == req.user_id).first()
    if not user or not user.githubUsername:
        raise HTTPException(status_code=400, detail="User not found or GitHub not connected")

    applicant_username = user.githubUsername

    # 0.1 Pre-check: is the repo accessible at all? Fail fast on private/404
    # so we don't burn 5 minutes of audit only to mark it REJECTED with a
    # generic error. Surfaces structured ``error_code`` so the frontend can
    # render the right fix-flow UI.
    accessible, error_code = _check_repo_accessibility(req.repo_url)
    if not accessible:
        if error_code == "private_repo_no_access":
            raise HTTPException(status_code=403, detail=_PRIVATE_REPO_ERROR_DETAIL)
        if error_code == "invalid_url":
            raise HTTPException(status_code=400, detail={
                "error_code": "invalid_url",
                "title": "Repository URL doesn't look right",
                "message": "Expected something like https://github.com/owner/repo.",
            })
        # Unknown error — fall through and let the audit try; it'll fail
        # with a clearer reason if we hit it again.

    # 0.5 Dedup: if this user already has this repo imported, reuse the row.
    # Without this, every click of "Audit" creates a fresh Project — the
    # frontend ends up with duplicate cards and we waste LLM calls.
    # Re-auditing intentionally is a separate /reaudit flow (not built yet).
    existing = db.query(Project).filter(
        Project.user_id == req.user_id,
        Project.repo_url == req.repo_url,
    ).first()
    if existing is not None:
        existing_audit = db.query(ProjectAudit).filter(
            ProjectAudit.project_id == existing.id,
        ).first()
        log.info(
            "[v4] /import dedup hit — returning existing project_id=%s status=%s",
            existing.id, existing.verification_status,
        )
        # Status reflects what's already on the row:
        #   VERIFIED (V4 done)  -> "ready"
        #   PENDING             -> "pending" (poll for completion)
        #   REJECTED            -> "failed"
        status_map = {"VERIFIED": "ready", "PENDING": "pending", "REJECTED": "failed"}
        return {
            "status": status_map.get(existing.verification_status, "pending"),
            "project_id": str(existing.id),
            "project_audit_id": str(existing_audit.id) if existing_audit else None,
            "pipeline_version": "v4",
            "message": "Returning existing project — it was already imported.",
            "deduped": True,
        }

    # 1. Create pending Project + ProjectAudit rows. V4 background fills them in.
    repo_name = req.repo_url.split("/")[-1]
    project = Project(
        user_id=req.user_id,
        repo_url=req.repo_url,
        repo_name=repo_name,
        is_verified=False,
        verification_status="PENDING",
        authorship_percent=0.0,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    audit = ProjectAudit(
        project_id=project.id,
        tds_score=None,
        complexity_tier=None,
        scoring_version=4,
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)

    # 2. Kick off V4 pipeline in the background. All downstream work
    # (authorship, scoring, tags) happens inside this task.
    # ``V4_DEFAULT_VARIANCE_SAMPLES`` env var: 1 = free tier (single sample,
    # ~$1, ±15pt LLM variance), 3 = standard paid tier (median-of-3, ~$3,
    # ±5-7pt residual variance), 5 = high-assurance (~$5, ±3-5pt).
    variance_samples = int(os.environ.get("V4_DEFAULT_VARIANCE_SAMPLES", "1"))
    background_tasks.add_task(
        _run_v4_primary_background,
        str(audit.id),
        str(project.id),
        req.repo_url,
        applicant_username,
        variance_samples,
    )
    log.info(
        "[v4] enqueued primary audit for project_id=%s audit_id=%s",
        project.id, audit.id,
    )

    return {
        "status": "pending",
        "project_id": str(project.id),
        "project_audit_id": str(audit.id),
        "pipeline_version": "v4",
        "message": "Deep analysis started — poll /status/{project_id} for completion.",
        "deduped": False,
    }


# ──────────────────────────────────────────────
# PUBLIC ENDPOINTS (no auth, rate-limited)
# ──────────────────────────────────────────────

class PublicScanRequest(BaseModel):
    repo_url: str = Field(min_length=10, max_length=500)

class PublicAuditRequest(BaseModel):
    repo_url: str = Field(min_length=10, max_length=500)
    target_claims: list[str] | None = None


@router.post("/scan-public")
async def scan_public(
    req: PublicScanRequest,
    request: Request,
    audit_service: AuditService = Depends(get_audit_service),
):
    """Public pre-scan: stack detection, no auth required."""
    scan_limiter.check(request)
    try:
        result = await audit_service.scan_repo(req.repo_url, "public", None)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/audit-public")
async def audit_public(
    req: PublicAuditRequest,
    request: Request,
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_service),
):
    """Public full audit: no DB project save, results cached."""
    audit_limiter.check(request)

    # Check cache first (only use V2 cache entries that have score_breakdown)
    code_hash = get_repo_code_hash(audit_service.ingestor, req.repo_url)
    if code_hash:
        cached = AuditCacheService.get_cached_audit(db, req.repo_url, code_hash)
        if cached:
            # Skip stale V1 cache entries that lack score_breakdown
            report = cached.get("report") or {}
            has_breakdown = bool(report.get("score_breakdown"))
            if has_breakdown:
                return _format_public_score(cached, req.repo_url, from_cache=True)

    # Run audit (no authorship gating for public)
    try:
        result = await audit_service.run_audit(
            req.repo_url, "public", "Fullstack", req.target_claims, None
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Cache if verified
    if code_hash and result.get("status") == "VERIFIED":
        AuditCacheService.cache_audit_result(db, req.repo_url, code_hash, result)

    if result["status"] == "REJECTED":
        return {
            "status": "REJECTED",
            "reason": result.get("reason", "Project did not meet minimum requirements"),
        }

    return _format_public_score(result, req.repo_url, from_cache=False)


@router.get("/status/{project_id}")
async def get_project_audit_status(
    project_id: str,
    db: Session = Depends(get_db),
):
    """Polling endpoint for the V4 async UX.

    Returns a small payload the frontend can hit every ~15s after /import:
    - ``v3_ready`` — V3 audit row exists (should always be true right after /import)
    - ``v4_ready`` — V4 shadow task completed for this project
    - ``v4_status`` — ``pending`` | ``ready`` | ``failed`` (derived)
    - ``v4`` — the full V4 bundle when ready, matching the shape /me/projects uses

    Once ``v4_ready=true`` the caller can stop polling.
    """
    try:
        pid = uuid.UUID(project_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid project_id")

    audit = (
        db.query(ProjectAudit)
        .filter(ProjectAudit.project_id == pid)
        .first()
    )
    if audit is None:
        # No audit row yet — project may have been rejected or is mid-insert.
        return {
            "project_id": project_id,
            "v3_ready": False,
            "v4_ready": False,
            "v4_status": "pending",
            "v4": None,
        }

    v4_ready = audit.v4_output is not None and audit.v4_audited_at is not None

    # `failed` signals "V4 shadow task errored" — we don't track that explicitly
    # yet, but we can use a stale-heuristic: audit older than 20 min with no V4
    # suggests the shadow task failed. Conservative for now.
    v4_status = "ready" if v4_ready else "pending"
    if not v4_ready and audit.audited_at is not None:
        age = datetime.now(timezone.utc) - audit.audited_at.replace(
            tzinfo=timezone.utc
        ) if audit.audited_at.tzinfo is None else datetime.now(timezone.utc) - audit.audited_at
        if age.total_seconds() > 20 * 60:
            v4_status = "failed"

    return {
        "project_id": project_id,
        "v3_ready": audit.tds_score is not None,
        "v4_ready": v4_ready,
        "v4_status": v4_status,
        "v4": {
            "score": audit.v4_score,
            "tier": audit.v4_tier,
            "output": audit.v4_output,
            "audited_at": (
                audit.v4_audited_at.isoformat() if audit.v4_audited_at else None
            ),
        } if v4_ready else None,
    }


@router.get("/score/{owner}/{repo}")
async def get_public_score(
    owner: str,
    repo: str,
    db: Session = Depends(get_db),
):
    """Lookup cached score for a repo. Powers /score/[owner]/[repo] page.

    Returns V3 fields from ``audit_cache`` (always) and — when a verified
    project exists for this repo with V4 data populated — also a ``v4``
    block. Frontend prefers V4 when present.
    """
    repo_url = f"https://github.com/{owner}/{repo}"

    entry = (
        db.query(AuditCache)
        .filter(AuditCache.repo_url == repo_url)
        .order_by(desc(AuditCache.created_at))
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="No score found for this repository")

    report = entry.audit_report or {}
    breakdown = report.get("score_breakdown", {})

    response = {
        "owner": owner,
        "repo": repo,
        "repo_url": repo_url,
        "score": entry.tds_score,
        "tier": entry.complexity_tier,
        "discipline": entry.discipline,
        "scoring_version": entry.scoring_version or 1,
        "score_breakdown": breakdown,
        "breakdown_available": bool(breakdown),
        "claims": report.get("claims", []),
        "stack": entry.stack or {},
        "authorship": entry.authorship,
        "forensics_data": entry.forensics_data,
        "intent_signals": entry.intent_signals,
        "scored_at": entry.created_at.isoformat() if entry.created_at else None,
    }

    # V4 augmentation — find the most recent verified project with V4 data
    # for this repo. Applicant-specific scores, so "first verified" wins on
    # the public page (essentially whoever claimed it).
    v4_row = (
        db.query(ProjectAudit)
        .join(Project, ProjectAudit.project_id == Project.id)
        .filter(
            Project.repo_url == repo_url,
            Project.is_verified == True,  # noqa: E712
            ProjectAudit.v4_output.isnot(None),
        )
        .order_by(desc(ProjectAudit.v4_audited_at))
        .first()
    )
    if v4_row is not None:
        response["v4"] = {
            "score": v4_row.v4_score,
            "tier": v4_row.v4_tier,
            "output": v4_row.v4_output,
            "audited_at": (
                v4_row.v4_audited_at.isoformat()
                if v4_row.v4_audited_at else None
            ),
        }

    return response


@router.get("/recent-scores")
async def get_recent_scores(
    db: Session = Depends(get_db),
    limit: int = 6,
):
    """Latest scored repos from cache. Powers 'Recently Scored' landing section."""
    entries = (
        db.query(AuditCache)
        .order_by(desc(AuditCache.created_at))
        .limit(min(limit, 12))
        .all()
    )

    # Deduplicate by repo_url (keep most recent)
    seen = set()
    results = []
    for e in entries:
        if e.repo_url in seen:
            continue
        seen.add(e.repo_url)
        match = re.search(r"github\.com/([^/]+)/([^/]+)", e.repo_url)
        owner = match.group(1) if match else ""
        repo_name = match.group(2) if match else e.repo_url
        results.append({
            "owner": owner,
            "repo": repo_name,
            "repo_url": e.repo_url,
            "score": e.tds_score,
            "tier": e.complexity_tier,
            "discipline": e.discipline,
            "stack": e.stack or {},
            "scored_at": e.created_at.isoformat() if e.created_at else None,
        })

    return {"scores": results}


def _format_public_score(result: dict, repo_url: str, from_cache: bool) -> dict:
    """Format audit result for public response."""
    match = re.search(r"github\.com/([^/]+)/([^/]+)", repo_url)
    owner = match.group(1) if match else ""
    repo = match.group(2) if match else repo_url

    return {
        "status": "VERIFIED",
        "owner": owner,
        "repo": repo,
        "repo_url": repo_url,
        "score": result["score"],
        "tier": result["tier"],
        "discipline": result.get("discipline"),
        "scoring_version": result.get("scoring_version", 1),
        "score_breakdown": result.get("report", {}).get("score_breakdown", {}),
        "claims": result.get("report", {}).get("claims", []),
        "stack": result.get("stack", {}),
        "authorship": result.get("authorship"),
        "forensics_data": result.get("forensics_data"),
        "intent_signals": result.get("intent_signals"),
        "cached": from_cache,
    }
