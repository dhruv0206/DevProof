"""Smoke test for run_v4_with_variance.

Runs nanoid (small repo, ~30s per sample) with samples=3 and verifies:
- variance metadata is populated (median, spread, confidence)
- canonical v4_output has pipeline_meta.variance stamped
- subsequent call hits tier-2 cache and returns the same median

The test must invalidate any existing tier-2 cache entry first to force fresh
samples (otherwise variance dampening can't be observed).
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from pathlib import Path

_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_AI_ENGINE_DIR))

from dotenv import load_dotenv
load_dotenv(_AI_ENGINE_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("verify-variance")

from app.database import SessionLocal  # noqa: E402
from app.services.v4_shadow_runner import run_v4_with_variance  # noqa: E402
from devproof_ranking_algo.v4.repo_author import resolve_repo_author  # noqa: E402

REPO_URL = "https://github.com/ai/nanoid"  # small lib — fast per-sample


async def main():
    author = resolve_repo_author(REPO_URL)
    log.info("repo=%s author=%s — running variance audit (samples=3)", REPO_URL, author)

    # Wipe any existing tier-2 cache row so the variance dampening actually runs
    # 3 fresh samples (otherwise we'd hit the cache and skip the test).
    try:
        from app.services.cache_service import get_repo_code_hash
        from devproof_ranking_algo import GithubIngestor
        ingestor = GithubIngestor()
        code_hash = get_repo_code_hash(ingestor, REPO_URL)
    except Exception as e:
        log.warning("couldn't compute code_hash for invalidation: %s", e)
        code_hash = None

    if code_hash and author:
        from app.models.audit_v4_cache import AuditV4Cache
        with SessionLocal() as db:
            deleted = (
                db.query(AuditV4Cache)
                .filter(
                    AuditV4Cache.repo_url == REPO_URL,
                    AuditV4Cache.code_hash == code_hash,
                    AuditV4Cache.applicant_username == author,
                )
                .delete(synchronize_session=False)
            )
            db.commit()
            log.info("invalidated %d existing tier-2 cache rows", deleted)

    t0 = time.monotonic()
    result = await run_v4_with_variance(
        REPO_URL,
        github_username=author,
        db_session_factory=SessionLocal,
        samples=3,
        run_full_pipeline=True,
        enable_verify=False,
    )
    elapsed = time.monotonic() - t0
    log.info("first audit elapsed=%.1fs succeeded=%s", elapsed, result.get("succeeded"))

    variance = result.get("variance") or {}
    print("\n" + "=" * 80)
    print("VARIANCE METADATA (first audit, fresh samples)")
    print("=" * 80)
    print(json.dumps(variance, indent=2))

    v4 = result.get("v4_output") or {}
    pm = v4.get("pipeline_meta") or {}
    print("\npipeline_meta.variance (stamped onto v4_output):")
    print(json.dumps(pm.get("variance"), indent=2))
    print(f"\ncanonical repo_score: {v4.get('repo_score')}  (== median: {variance.get('median')})")

    if variance.get("median") != v4.get("repo_score"):
        log.warning("DRIFT: canonical score (%s) does NOT match median (%s)",
                    v4.get("repo_score"), variance.get("median"))

    # Now run again — should hit tier-2 cache and return same median instantly
    log.info("\n--- running again (should hit cache) ---")
    t1 = time.monotonic()
    result2 = await run_v4_with_variance(
        REPO_URL,
        github_username=author,
        db_session_factory=SessionLocal,
        samples=3,
        run_full_pipeline=True,
        enable_verify=False,
    )
    elapsed2 = time.monotonic() - t1
    variance2 = result2.get("variance") or {}
    score2 = (result2.get("v4_output") or {}).get("repo_score")
    log.info("second audit elapsed=%.1fs cache=%s score=%s (median match: %s)",
             elapsed2, result2.get("cache_reused"), score2,
             score2 == variance.get("median"))

    print("\n" + "=" * 80)
    print("VERIFICATION")
    print("=" * 80)
    checks = [
        ("variance.median present", variance.get("median") is not None),
        ("variance.confidence present", variance.get("confidence") is not None),
        ("canonical score == median", v4.get("repo_score") == variance.get("median")),
        ("samples == 3", variance.get("samples") == 3),
        ("n_valid >= 1", (variance.get("n_valid") or 0) >= 1),
        ("second audit hits cache", elapsed2 < elapsed / 4),
        ("second audit same median", score2 == variance.get("median")),
    ]
    passed = sum(1 for _, ok in checks if ok)
    for name, ok in checks:
        print(f"  {'✓' if ok else '✗'} {name}")
    print(f"\n{passed}/{len(checks)} checks passed")
    return passed, len(checks)


if __name__ == "__main__":
    asyncio.run(main())
