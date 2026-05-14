"""Watchdog that monitors corpus grow progress and restarts grower if stalled.

Logic:
1. Poll Supabase every N minutes for audit count.
2. If count hasn't changed in STALL_THRESHOLD minutes, restart grower.
3. If grower restarts 3+ times in 30 min, give up (something fundamentally wrong).

Usage: run alongside the grower in background.
    python -m scripts.corpus_grower.watchdog
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

CHECK_INTERVAL_SEC = 300  # 5 min
STALL_THRESHOLD_SEC = 900  # 15 min — if no new audit for 15 min, restart
MAX_RESTARTS = 3
RESTART_WINDOW_SEC = 1800  # 30 min

log = logging.getLogger("watchdog")


def get_audit_count_and_latest() -> tuple[int, datetime | None]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL env var is required (set in ai-engine/.env).")
    with psycopg2.connect(url, connect_timeout=15) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), MAX(audited_at) FROM corpus_silver_tier WHERE succeeded = TRUE")
            row = cur.fetchone()
            return int(row[0]), row[1]


def restart_grower() -> subprocess.Popen:
    """Launch the grower as a new background subprocess."""
    log.info("restarting grower")
    return subprocess.Popen(
        [
            sys.executable, "-X", "utf8", "-m", "scripts.corpus_grower.grower",
            "--concurrency", "3",
        ],
        cwd=str(Path(__file__).resolve().parent.parent.parent),
        stdout=open(
            f"D:/Projects/github-contributions-search/ai-engine/diagnostic/corpus_restart_{datetime.now().strftime('%H%M%S')}.log",
            "w",
        ),
        stderr=subprocess.STDOUT,
    )


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    last_count, _ = get_audit_count_and_latest()
    last_change_time = time.monotonic()
    restart_times: list[float] = []

    log.info("watchdog start: count=%d", last_count)

    while True:
        time.sleep(CHECK_INTERVAL_SEC)
        try:
            count, latest = get_audit_count_and_latest()
        except Exception as e:
            log.warning("DB check failed: %s", e)
            continue

        now = time.monotonic()
        if count > last_count:
            log.info("progress: %d audits (latest=%s)", count, latest)
            last_count = count
            last_change_time = now

        if count >= 100:
            log.info("target 100 reached, stopping watchdog")
            return

        stall_sec = now - last_change_time
        if stall_sec > STALL_THRESHOLD_SEC:
            # Stalled. Restart.
            restart_times = [t for t in restart_times if now - t < RESTART_WINDOW_SEC]
            if len(restart_times) >= MAX_RESTARTS:
                log.error(
                    "stalled %d sec but already restarted %d times in last %d sec; giving up",
                    int(stall_sec), len(restart_times), RESTART_WINDOW_SEC,
                )
                return
            restart_grower()
            restart_times.append(now)
            last_change_time = now  # reset stall timer


if __name__ == "__main__":
    main()
