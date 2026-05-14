"""Main corpus grower orchestrator.

Pulls seed repos, audits each via V4, judges via second LLM, writes to
Supabase corpus_silver_tier. Idempotent (skips already-completed repos).
Concurrent (audits N repos in parallel up to CORPUS_CONCURRENCY).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_AI_ENGINE_DIR))

from dotenv import load_dotenv
load_dotenv(_AI_ENGINE_DIR / ".env")

# Logfire (best-effort)
try:
    import logfire
    logfire.configure(
        service_name="devproof-corpus-grower",
        send_to_logfire="if-token-present",
        console=False,
    )
except Exception:
    pass

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.database as appdb
appdb.DATABASE_URL = os.environ.get("DATABASE_URL")
if not appdb.DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL env var is required. Set it in ai-engine/.env or "
        "export it before running the corpus grower."
    )
appdb.engine = create_engine(appdb.DATABASE_URL)
appdb.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=appdb.engine)

from app.services.v4_shadow_runner import run_v4_cached  # noqa: E402

from scripts.corpus_grower.db import (  # noqa: E402
    insert_audit, list_completed_urls, count_audits,
)
from scripts.corpus_grower.judge import judge_audit  # noqa: E402
from scripts.corpus_grower.seed_repos import get_seed_list  # noqa: E402

log = logging.getLogger("corpus-grower")

CORPUS_CONCURRENCY = int(os.environ.get("CORPUS_CONCURRENCY", "3"))
ALGO_VERSION = "v4-corpus-2026-05-14"

_REPO_URL_RE = re.compile(r"github\.com/([^/]+)/([^/]+?)(?:\.git|/.*)?$")


def _parse_owner(url: str) -> tuple[Optional[str], Optional[str]]:
    m = _REPO_URL_RE.search(url)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def _row_from_audit(
    repo_url: str,
    discovery_source: str,
    discovery_language: str,
    discovery_tier: str,
    audit: dict[str, Any],
    judge: dict[str, Any],
    elapsed_ms: int,
) -> dict[str, Any]:
    v4 = audit.get("v4_output") or {}
    sb = v4.get("score_breakdown") or {}
    claims = v4.get("claims") or []
    tier3_count = sum(
        1 for c in claims
        if (c.get("tier") or "").upper().endswith("DEEP")
    )
    score = v4.get("repo_score")

    return {
        "repo_url": repo_url,
        "commit_sha": audit.get("commit_sha"),
        "algo_version": ALGO_VERSION,
        "discovery_source": discovery_source,
        "discovery_language": discovery_language,
        "discovery_tier": discovery_tier,
        "samples": 1,
        "raw_scores": [score] if score is not None else [],
        "median_score": score,
        "p25_score": score,
        "p75_score": score,
        "variance_confidence": "single-sample",
        "repo_score": score,
        "repo_tier": v4.get("repo_tier"),
        "discipline": v4.get("discipline"),
        "features_score": (sb.get("features") or {}).get("score"),
        "architecture_score": (sb.get("architecture") or {}).get("score"),
        "intent_score": (sb.get("intent_and_standards") or {}).get("score"),
        "forensics_score": (sb.get("forensics") or {}).get("score"),
        "ownership_score": v4.get("ownership_score"),
        "claim_count": len(claims),
        "tier3_count": tier3_count,
        "judge_confidence": judge.get("confidence"),
        "judge_notes": json.dumps({
            "agrees_with_tier": judge.get("agrees_with_tier"),
            "concerns": judge.get("concerns", []),
        }),
        "flagged_for_review": judge.get("flag_for_review", False),
        "repo_metadata": {
            "graph_stats": audit.get("graph_stats"),
            "errors": audit.get("errors") or [],
        },
        "v4_output": v4,
        "errors": audit.get("errors") or [],
        "succeeded": bool(audit.get("succeeded")),
        "total_ms": elapsed_ms,
    }


def _row_from_failure(
    repo_url: str,
    discovery_source: str,
    discovery_language: str,
    discovery_tier: str,
    error: str,
    elapsed_ms: int,
) -> dict[str, Any]:
    return {
        "repo_url": repo_url,
        "commit_sha": None,
        "algo_version": ALGO_VERSION,
        "discovery_source": discovery_source,
        "discovery_language": discovery_language,
        "discovery_tier": discovery_tier,
        "samples": 0,
        "raw_scores": [],
        "median_score": None,
        "p25_score": None,
        "p75_score": None,
        "variance_confidence": "failed",
        "repo_score": None,
        "repo_tier": None,
        "discipline": None,
        "features_score": None,
        "architecture_score": None,
        "intent_score": None,
        "forensics_score": None,
        "ownership_score": None,
        "claim_count": 0,
        "tier3_count": 0,
        "judge_confidence": None,
        "judge_notes": None,
        "flagged_for_review": True,
        "repo_metadata": {},
        "v4_output": None,
        "errors": [error],
        "succeeded": False,
        "total_ms": elapsed_ms,
    }


async def audit_one(entry: tuple[str, str, str, str]) -> dict[str, Any]:
    """Audit a single repo and write to corpus. Returns the row dict."""
    repo_url, source, language, tier_hint = entry
    owner, _name = _parse_owner(repo_url)
    if owner is None:
        return _row_from_failure(repo_url, source, language, tier_hint, "invalid_url", 0)

    # Resolve author: user-owned → user, org-owned → top contributor
    try:
        from devproof_ranking_algo.v4.repo_author import resolve_repo_author
        author = resolve_repo_author(repo_url)
    except Exception as e:
        log.warning("author resolve failed for %s: %s", repo_url, e)
        author = owner

    t0 = time.monotonic()
    try:
        audit = await run_v4_cached(
            repo_url,
            github_username=author,
            db_session_factory=appdb.SessionLocal,
            run_full_pipeline=True,
            enable_verify=False,
        )
    except Exception as e:  # noqa: BLE001
        elapsed = int((time.monotonic() - t0) * 1000)
        log.exception("audit failed for %s: %s", repo_url, e)
        row = _row_from_failure(repo_url, source, language, tier_hint, f"audit_raised: {e}", elapsed)
        try:
            insert_audit(row)
        except Exception as ie:
            log.exception("insert failed for failed audit %s: %s", repo_url, ie)
        return row

    elapsed = int((time.monotonic() - t0) * 1000)

    # Judge LLM (best effort; failure doesn't break the audit)
    v4 = audit.get("v4_output") or {}
    if v4:
        judge = judge_audit(v4, repo_url)
    else:
        judge = {
            "confidence": 0.0,
            "agrees_with_tier": False,
            "concerns": ["audit_returned_no_v4_output"],
            "flag_for_review": True,
        }

    row = _row_from_audit(repo_url, source, language, tier_hint, audit, judge, elapsed)
    try:
        insert_audit(row)
        log.info(
            "audited %s | score=%s tier=%s judge=%.2f elapsed=%dms",
            repo_url, row.get("repo_score"), row.get("repo_tier"),
            judge.get("confidence") or 0.0, elapsed,
        )
    except Exception as e:
        log.exception("insert failed for %s: %s", repo_url, e)

    return row


async def grow_corpus(
    *,
    limit: Optional[int] = None,
    skip_existing: bool = True,
    concurrency: Optional[int] = None,
    slice_start: int = 0,
    slice_end: Optional[int] = None,
    reverse: bool = False,
) -> dict[str, Any]:
    """Run the corpus grower on the seed list.

    slice_start / slice_end let you carve out a disjoint subset of the
    full seed list (useful for parallel growers without race conditions).
    reverse=True processes the slice in reverse so two parallel growers
    can avoid duplicating early entries.
    """
    sem = asyncio.Semaphore(concurrency or CORPUS_CONCURRENCY)

    seeds = get_seed_list()
    if slice_end is not None:
        seeds = seeds[slice_start:slice_end]
    elif slice_start:
        seeds = seeds[slice_start:]
    if limit:
        seeds = seeds[:limit]
    if reverse:
        seeds = list(reversed(seeds))

    if skip_existing:
        completed = list_completed_urls()
        if completed:
            seeds = [s for s in seeds if s[0] not in completed]
            log.info("skipping %d already-completed", len(completed))

    log.info("growing corpus: %d repos to audit (concurrency=%d)", len(seeds), sem._value)

    async def _bounded(entry):
        async with sem:
            return await audit_one(entry)

    t0 = time.monotonic()
    rows = await asyncio.gather(*[_bounded(e) for e in seeds], return_exceptions=True)
    elapsed = time.monotonic() - t0

    succeeded = sum(1 for r in rows if isinstance(r, dict) and r.get("succeeded"))
    failed = sum(1 for r in rows if not (isinstance(r, dict) and r.get("succeeded")))

    summary = {
        "audited": len(seeds),
        "succeeded": succeeded,
        "failed": failed,
        "elapsed_s": round(elapsed, 1),
        "total_in_corpus": count_audits(succeeded_only=True),
    }
    log.info("corpus grow complete: %s", summary)
    return summary


if __name__ == "__main__":
    import argparse
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--concurrency", type=int, default=None)
    parser.add_argument("--no-skip", action="store_true", help="Re-audit all (don't skip completed)")
    parser.add_argument("--slice-start", type=int, default=0)
    parser.add_argument("--slice-end", type=int, default=None)
    parser.add_argument("--reverse", action="store_true",
        help="Process slice in reverse — useful for second parallel grower")
    parser.add_argument("--report-out",
        default="D:/Projects/github-contributions-search/ai-engine/diagnostic/corpus_morning_report.md")
    args = parser.parse_args()

    result = asyncio.run(grow_corpus(
        limit=args.limit,
        skip_existing=not args.no_skip,
        concurrency=args.concurrency,
        slice_start=args.slice_start,
        slice_end=args.slice_end,
        reverse=args.reverse,
    ))
    print(json.dumps(result, indent=2))

    # Auto-generate morning report after grow completes.
    try:
        from scripts.corpus_grower.report import generate_report
        out = generate_report(Path(args.report_out))
        print(f"\nMorning report: {out}")
    except Exception as e:
        log.exception("report generation failed: %s", e)
