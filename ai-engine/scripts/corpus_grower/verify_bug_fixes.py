"""Verify Bug #1 + Bug #2 fixes against known cases.

Re-audits openai-cookbook, vuejs/core, sveltejs/svelte, django, requests
WITHOUT using the cache (so we see the NEW algo output, not the cached
pre-fix scores). Prints before/after side-by-side.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_AI_ENGINE_DIR))

from dotenv import load_dotenv
load_dotenv(_AI_ENGINE_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
log = logging.getLogger("verify-fixes")

from app.services.v4_shadow_runner import run_v4  # noqa: E402

# Expected before/after per repo. These are based on the 2026-05-14 corpus.
# Wider regression bands acknowledge ±15pt LLM variance for repos NOT
# affected by our new detectors.
CASES = [
    # repo_url,                                       before, expected_after_min, expected_after_max, reason
    # Round 2: Verify tutorial detector still works after tightening
    ("https://github.com/openai/openai-cookbook",      89,     0,    55,  "tutorial cap (README + ratio)"),
    # Round 2: Verify compiler detection still works
    ("https://github.com/vuejs/core",                  62,     85,   100, "compiler+runtime boost"),
    # Round 2: Verify former tutorial-cap FALSE POSITIVES now score correctly
    ("https://github.com/expressjs/express",           55,     65,   95,  "Fixed false positive: real library w/ examples"),
    ("https://github.com/charmbracelet/bubbletea",     55,     65,   95,  "Fixed false positive: TUI lib w/ many demos"),
    ("https://github.com/Textualize/rich",             55,     70,   100, "Fixed false positive: real Python library"),
]


def _resolve_author(repo_url: str) -> str | None:
    try:
        from devproof_ranking_algo.v4.repo_author import resolve_repo_author
        return resolve_repo_author(repo_url)
    except Exception as e:
        log.warning("author resolve failed for %s: %s", repo_url, e)
        return None


async def audit_uncached(repo_url: str) -> dict:
    """Run V4 without cache so we see the new algo output."""
    author = _resolve_author(repo_url)
    t0 = time.monotonic()
    result = await run_v4(
        repo_url,
        github_username=author,
        run_full_pipeline=True,
        enable_verify=False,
    )
    elapsed = time.monotonic() - t0
    v4 = result.get("v4_output") or {}
    sb = v4.get("score_breakdown") or {}
    pm = v4.get("pipeline_meta") or {}
    return {
        "repo_url": repo_url,
        "score": v4.get("repo_score"),
        "tier": v4.get("repo_tier"),
        "features": (sb.get("features") or {}).get("score"),
        "arch": (sb.get("architecture") or {}).get("score"),
        "intent": (sb.get("intent_and_standards") or {}).get("score"),
        "forensics": (sb.get("forensics") or {}).get("score"),
        "ownership": v4.get("ownership_score"),
        "claim_count": len(v4.get("claims") or []),
        "repo_type": pm.get("repo_type"),
        "repo_classification": pm.get("repo_classification"),
        "succeeded": result.get("succeeded"),
        "errors": result.get("errors"),
        "elapsed_s": round(elapsed, 1),
    }


async def main():
    sem = asyncio.Semaphore(3)

    async def _bounded(repo_url):
        async with sem:
            log.info("starting audit for %s", repo_url)
            return await audit_uncached(repo_url)

    tasks = [_bounded(c[0]) for c in CASES]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    print("\n" + "=" * 100)
    print("BUG FIX VERIFICATION RESULTS")
    print("=" * 100)
    for case, result in zip(CASES, results):
        repo_url, before, lo, hi, reason = case
        if isinstance(result, Exception):
            print(f"\n❌ {repo_url}: {result}")
            continue
        score = result.get("score")
        in_range = (score is not None) and (lo <= score <= hi)
        delta = (score or 0) - before
        marker = "✓" if in_range else ("✗" if score is not None else "?")
        print(f"\n{marker} {repo_url}")
        print(f"   Before: {before}   After: {score}   Delta: {delta:+d}   Expected: [{lo}, {hi}]")
        print(f"   Reason: {reason}")
        print(f"   Breakdown: F={result.get('features')}/40 A={result.get('arch')}/15 "
              f"I={result.get('intent')}/25 Fo={result.get('forensics')}/20 "
              f"Own={result.get('ownership')}")
        rc = result.get("repo_classification") or {}
        if rc:
            print(f"   repo_type: {rc.get('type')} ({rc.get('reason', '')[:80]})")
            print(f"   compiler_stages: {rc.get('compiler_stage_count', 0)}  "
                  f"runtime_subsystems: {rc.get('runtime_subsystem_count', 0)}")
        print(f"   elapsed: {result.get('elapsed_s')}s, claims: {result.get('claim_count')}, "
              f"errors: {len(result.get('errors') or [])}")
        if result.get('errors'):
            print(f"   error tail: {result['errors'][-1][:200]}")

    print("\n" + "=" * 100)
    passed = sum(
        1 for case, result in zip(CASES, results)
        if not isinstance(result, Exception)
        and result.get("score") is not None
        and case[2] <= result.get("score") <= case[3]
    )
    total = len(CASES)
    print(f"RESULT: {passed}/{total} cases in expected range")
    print("=" * 100)

    return passed, total


if __name__ == "__main__":
    asyncio.run(main())
