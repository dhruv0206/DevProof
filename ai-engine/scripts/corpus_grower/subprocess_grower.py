"""Subprocess-per-audit corpus grower.

Each audit runs in a fresh Python subprocess, eliminating in-process
resource leaks (asyncio pool exhaustion, httpx connection pool, etc.)
that have caused the in-process grower to stall after 1-3 audits.

Trade-off: ~5-10s extra overhead per audit for interpreter startup,
but reliably completes 100s of audits without restart.
"""
from __future__ import annotations

import concurrent.futures
import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_AI_ENGINE_DIR))

from scripts.corpus_grower.db import list_completed_urls  # noqa: E402
from scripts.corpus_grower.seed_repos import get_seed_list  # noqa: E402

PYTHON = sys.executable
WORKER_SCRIPT = str(Path(__file__).parent / "subprocess_worker.py")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("sub-grower")


def audit_one_subprocess(entry: tuple[str, str, str, str], timeout: int = 900) -> dict:
    repo_url, source, language, tier_hint = entry
    log.info(f"starting subprocess for {repo_url}")
    t0 = time.monotonic()
    try:
        result = subprocess.run(
            [PYTHON, "-X", "utf8", WORKER_SCRIPT,
             "--repo-url", repo_url,
             "--source", source,
             "--language", language,
             "--tier", tier_hint],
            cwd=str(_AI_ENGINE_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        elapsed = time.monotonic() - t0
        if result.returncode == 0:
            try:
                row = json.loads(result.stdout.strip().split("\n")[-1])
                log.info(f"audited {repo_url} | score={row.get('repo_score')} elapsed={elapsed:.0f}s")
                return row
            except Exception as e:
                log.exception(f"failed to parse worker output for {repo_url}: {e}")
                log.error(f"stdout: {result.stdout[-500:]}")
                return {"repo_url": repo_url, "succeeded": False, "errors": [f"parse: {e}"]}
        else:
            log.error(f"subprocess failed for {repo_url} rc={result.returncode}")
            log.error(f"stderr tail: {result.stderr[-500:]}")
            return {"repo_url": repo_url, "succeeded": False, "errors": [f"rc={result.returncode}"]}
    except subprocess.TimeoutExpired:
        log.error(f"subprocess timeout for {repo_url} after {timeout}s")
        return {"repo_url": repo_url, "succeeded": False, "errors": ["timeout"]}
    except Exception as e:
        log.exception(f"subprocess crashed for {repo_url}: {e}")
        return {"repo_url": repo_url, "succeeded": False, "errors": [str(e)]}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--slice-start", type=int, default=0)
    parser.add_argument("--slice-end", type=int, default=None)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()

    seeds = get_seed_list()
    if args.slice_end is not None:
        seeds = seeds[args.slice_start:args.slice_end]
    elif args.slice_start:
        seeds = seeds[args.slice_start:]

    completed = list_completed_urls()
    seeds = [s for s in seeds if s[0] not in completed]
    log.info(f"to audit: {len(seeds)} repos (concurrency={args.concurrency})")

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(audit_one_subprocess, s, args.timeout) for s in seeds]
        succeeded = 0
        failed = 0
        for fut in concurrent.futures.as_completed(futures):
            row = fut.result()
            if row.get("succeeded"):
                succeeded += 1
            else:
                failed += 1
            log.info(f"progress: {succeeded} ok / {failed} fail")

    log.info(f"DONE: {succeeded} succeeded, {failed} failed")


if __name__ == "__main__":
    main()
