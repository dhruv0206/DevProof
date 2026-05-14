"""Supabase Postgres connection + write layer for the corpus grower."""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import psycopg2
from psycopg2.extras import Json

log = logging.getLogger(__name__)

def get_conn():
    """Return a fresh psycopg2 connection. Caller closes.

    Reads DATABASE_URL from environment (loaded from ai-engine/.env in
    callers that use python-dotenv). No fallback — keeps secrets out of
    source.
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL env var is required. Set it in ai-engine/.env or "
            "export it before running corpus_grower."
        )
    return psycopg2.connect(url, connect_timeout=15)


def already_audited(repo_url: str) -> bool:
    """True if this repo already has a successful audit in the corpus."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM corpus_silver_tier WHERE repo_url = %s AND succeeded = TRUE LIMIT 1",
                (repo_url,),
            )
            return cur.fetchone() is not None


def insert_audit(row: dict[str, Any]) -> int:
    """Insert a corpus audit row. Returns id."""
    cols = [
        "repo_url", "commit_sha", "algo_version",
        "discovery_source", "discovery_language", "discovery_tier",
        "samples", "raw_scores", "median_score", "p25_score", "p75_score",
        "variance_confidence",
        "repo_score", "repo_tier", "discipline",
        "features_score", "architecture_score", "intent_score",
        "forensics_score", "ownership_score",
        "claim_count", "tier3_count",
        "judge_confidence", "judge_notes", "flagged_for_review",
        "repo_metadata", "v4_output", "errors",
        "succeeded", "total_ms",
    ]
    values = []
    for c in cols:
        v = row.get(c)
        if c in ("raw_scores", "repo_metadata", "v4_output", "errors"):
            v = Json(v) if v is not None else None
        values.append(v)

    sql = f"""
        INSERT INTO corpus_silver_tier ({", ".join(cols)})
        VALUES ({", ".join(["%s"] * len(cols))})
        RETURNING id
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, values)
            new_id = cur.fetchone()[0]
        conn.commit()
    return new_id


def count_audits(*, succeeded_only: bool = False) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            if succeeded_only:
                cur.execute("SELECT COUNT(*) FROM corpus_silver_tier WHERE succeeded = TRUE")
            else:
                cur.execute("SELECT COUNT(*) FROM corpus_silver_tier")
            return cur.fetchone()[0]


def list_completed_urls() -> set[str]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT repo_url FROM corpus_silver_tier WHERE succeeded = TRUE"
            )
            return {r[0] for r in cur.fetchall()}
