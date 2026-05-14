"""Quick query CLI for the corpus.

Usage:
    python -m scripts.corpus_grower.query stats
    python -m scripts.corpus_grower.query top --n 20
    python -m scripts.corpus_grower.query flagged
    python -m scripts.corpus_grower.query repo <url-fragment>
    python -m scripts.corpus_grower.query by-tier
    python -m scripts.corpus_grower.query failures
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

def _conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL env var is required (set in ai-engine/.env).")
    return psycopg2.connect(
        url,
        connect_timeout=15,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def _print_rows(rows: list[dict], cols: list[str]) -> None:
    if not rows:
        print("(no results)")
        return
    widths = {c: max(len(c), max(len(str(r.get(c) or "—")) for r in rows)) for c in cols}
    header = " | ".join(c.ljust(widths[c]) for c in cols)
    print(header)
    print("-" * len(header))
    for r in rows:
        print(" | ".join(str(r.get(c) or "—").ljust(widths[c]) for c in cols))


def cmd_stats(args):
    with _conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN succeeded THEN 1 ELSE 0 END) AS succeeded,
                SUM(CASE WHEN flagged_for_review THEN 1 ELSE 0 END) AS flagged,
                ROUND(AVG(repo_score)::numeric, 1) AS avg_score,
                MIN(repo_score) AS min_score,
                MAX(repo_score) AS max_score,
                ROUND(AVG(total_ms)::numeric, 0) AS avg_ms
            FROM corpus_silver_tier
        """)
        for k, v in cur.fetchone().items():
            print(f"  {k}: {v}")


def cmd_top(args):
    with _conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT repo_url, repo_score, repo_tier, judge_confidence, discovery_source
            FROM corpus_silver_tier
            WHERE succeeded = TRUE
            ORDER BY repo_score DESC NULLS LAST
            LIMIT %s
        """, (args.n,))
        _print_rows(list(cur.fetchall()), [
            "repo_url", "repo_score", "repo_tier", "judge_confidence", "discovery_source"
        ])


def cmd_flagged(args):
    with _conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT repo_url, repo_score, repo_tier, judge_confidence, judge_notes
            FROM corpus_silver_tier
            WHERE flagged_for_review = TRUE
            ORDER BY judge_confidence ASC NULLS LAST
        """)
        rows = list(cur.fetchall())
    print(f"Flagged: {len(rows)}\n")
    for r in rows:
        notes = r.get("judge_notes")
        try:
            parsed = json.loads(notes) if isinstance(notes, str) else (notes or {})
        except Exception:
            parsed = {}
        concerns = parsed.get("concerns", []) if isinstance(parsed, dict) else []
        print(f"  {r['repo_url']}")
        print(f"    score={r['repo_score']} tier={r['repo_tier']} judge={r['judge_confidence']}")
        for c2 in concerns[:3]:
            print(f"    - {c2}")
        print()


def cmd_repo(args):
    with _conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT * FROM corpus_silver_tier
            WHERE repo_url ILIKE %s
            ORDER BY audited_at DESC
            LIMIT 3
        """, (f"%{args.url_fragment}%",))
        rows = list(cur.fetchall())
    for r in rows:
        print("=" * 60)
        for k in ("repo_url", "audited_at", "repo_score", "repo_tier",
                  "features_score", "architecture_score", "intent_score",
                  "forensics_score", "ownership_score",
                  "judge_confidence", "flagged_for_review",
                  "claim_count", "tier3_count", "total_ms"):
            print(f"  {k:25s} {r.get(k)}")
        print()


def cmd_by_tier(args):
    with _conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT
                discovery_tier,
                COUNT(*) AS n,
                ROUND(AVG(repo_score)::numeric, 1) AS avg_score,
                MIN(repo_score) AS min_s,
                MAX(repo_score) AS max_s
            FROM corpus_silver_tier
            WHERE succeeded = TRUE
            GROUP BY discovery_tier
            ORDER BY avg_score DESC
        """)
        _print_rows(list(cur.fetchall()), [
            "discovery_tier", "n", "avg_score", "min_s", "max_s"
        ])


def cmd_failures(args):
    with _conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT repo_url, discovery_source, errors
            FROM corpus_silver_tier
            WHERE succeeded = FALSE
        """)
        rows = list(cur.fetchall())
    print(f"Failures: {len(rows)}\n")
    for r in rows:
        errs = r.get("errors") or []
        first = errs[0] if errs else "?"
        print(f"  {r['repo_url']:50s} {first[:60]}")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("stats")
    p_top = sub.add_parser("top"); p_top.add_argument("--n", type=int, default=20)
    sub.add_parser("flagged")
    p_repo = sub.add_parser("repo"); p_repo.add_argument("url_fragment")
    sub.add_parser("by-tier")
    sub.add_parser("failures")

    args = parser.parse_args()
    {
        "stats": cmd_stats,
        "top": cmd_top,
        "flagged": cmd_flagged,
        "repo": cmd_repo,
        "by-tier": cmd_by_tier,
        "failures": cmd_failures,
    }[args.cmd](args)


if __name__ == "__main__":
    main()
