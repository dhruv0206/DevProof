"""Single-audit worker. Runs ONE repo audit in a fresh interpreter then exits.

Stdout: last line = JSON dict of the audit result (which was also written to DB).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_AI_ENGINE_DIR))

from dotenv import load_dotenv
load_dotenv(_AI_ENGINE_DIR / ".env")

# Suppress noisy logs in subprocess to keep stdout clean (JSON only).
logging.basicConfig(level=logging.WARNING)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import app.database as appdb
appdb.DATABASE_URL = os.environ.get("DATABASE_URL")
if not appdb.DATABASE_URL:
    raise RuntimeError("DATABASE_URL env var is required (set in ai-engine/.env).")
appdb.engine = create_engine(appdb.DATABASE_URL)
appdb.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=appdb.engine)

from scripts.corpus_grower.grower import audit_one  # noqa: E402


async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-url", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--tier", required=True)
    args = parser.parse_args()

    entry = (args.repo_url, args.source, args.language, args.tier)
    row = await audit_one(entry)
    # Print clean JSON as last line (parser strips internal types).
    print(json.dumps({
        "repo_url": row.get("repo_url"),
        "succeeded": row.get("succeeded"),
        "repo_score": row.get("repo_score"),
        "repo_tier": row.get("repo_tier"),
        "judge_confidence": row.get("judge_confidence"),
        "total_ms": row.get("total_ms"),
        "errors": row.get("errors"),
    }))


if __name__ == "__main__":
    asyncio.run(main())
