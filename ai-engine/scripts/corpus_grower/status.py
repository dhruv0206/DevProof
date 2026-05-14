"""Single-screen morning status — prints everything important in one view."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import psycopg2

def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL env var is required (set in ai-engine/.env).")
    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()

    print("=" * 70)
    print(f"DEVPROOF CORPUS STATUS — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 70)

    # Overall
    cur.execute("""
        SELECT COUNT(*), SUM(CASE WHEN succeeded THEN 1 ELSE 0 END),
               SUM(CASE WHEN flagged_for_review THEN 1 ELSE 0 END),
               MIN(audited_at), MAX(audited_at)
        FROM corpus_silver_tier
    """)
    total, succeeded, flagged, first, last = cur.fetchone()
    print()
    print(f"  Total audits:       {total}/100 target")
    print(f"  Succeeded:          {succeeded}")
    print(f"  Failed:             {total - (succeeded or 0)}")
    print(f"  Flagged for review: {flagged}")
    print(f"  First audit:        {first}")
    print(f"  Last audit:         {last}")

    # Recent progress
    print()
    print("RECENT AUDITS (last 10):")
    cur.execute("""
        SELECT repo_url, repo_score, repo_tier, judge_confidence,
               flagged_for_review, total_ms, succeeded
        FROM corpus_silver_tier ORDER BY audited_at DESC LIMIT 10
    """)
    for url, score, tier, jc, flag, ms, ok in cur.fetchall():
        repo = url.replace("https://github.com/", "")
        marker = "X" if not ok else ("!" if flag else " ")
        score_s = str(score) if score is not None else "?"
        tier_s = (tier or "?").replace("TIER_", "T")
        jc_s = f"{jc:.2f}" if jc is not None else "?"
        time_s = f"{ms//1000}s" if ms else "?"
        print(f"  {marker} {repo:<40} score={score_s:>3} tier={tier_s:<10} judge={jc_s} {time_s}")

    # Stats
    print()
    print("SCORE DISTRIBUTION:")
    cur.execute("""
        SELECT ROUND(AVG(repo_score)::numeric, 1), MIN(repo_score), MAX(repo_score),
               COUNT(DISTINCT repo_tier)
        FROM corpus_silver_tier WHERE succeeded = TRUE
    """)
    avg, mn, mx, n_tiers = cur.fetchone()
    print(f"  mean={avg}  min={mn}  max={mx}  tiers_seen={n_tiers}")

    # Per discovery source
    print()
    print("BY DISCOVERY SOURCE:")
    cur.execute("""
        SELECT discovery_source, COUNT(*),
               SUM(CASE WHEN succeeded THEN 1 ELSE 0 END),
               ROUND(AVG(CASE WHEN succeeded THEN repo_score END)::numeric, 1)
        FROM corpus_silver_tier GROUP BY discovery_source ORDER BY COUNT(*) DESC
    """)
    for src, n, ok, avg in cur.fetchall():
        print(f"  {src:<30} {n:>3} total / {ok or 0:>3} ok / avg={avg}")

    # Failures
    cur.execute("SELECT COUNT(*) FROM corpus_silver_tier WHERE succeeded = FALSE")
    n_fail = cur.fetchone()[0]
    if n_fail:
        print()
        print(f"FAILURES ({n_fail}):")
        cur.execute("""
            SELECT repo_url, errors FROM corpus_silver_tier
            WHERE succeeded = FALSE ORDER BY audited_at DESC LIMIT 10
        """)
        for url, errs in cur.fetchall():
            first_err = (errs[0] if errs else "?")[:60]
            print(f"  {url:<55} {first_err}")

    print()
    print("=" * 70)
    print("NEXT STEPS:")
    if (total or 0) < 100:
        print(f"  Grower still running. {100 - (total or 0)} repos remaining.")
        print(f"  Resume manually if grower died:")
        print(f"    cd ai-engine && python -X utf8 -m scripts.corpus_grower.grower --concurrency 3")
    else:
        print("  Target reached. Generate full report:")
        print(f"    python -X utf8 -m scripts.corpus_grower.report")
    print()
    print("USEFUL QUERIES:")
    print("  python -X utf8 -m scripts.corpus_grower.query stats")
    print("  python -X utf8 -m scripts.corpus_grower.query top --n 20")
    print("  python -X utf8 -m scripts.corpus_grower.query flagged")
    print("  python -X utf8 -m scripts.corpus_grower.query failures")
    print("=" * 70)
    conn.close()


if __name__ == "__main__":
    main()
