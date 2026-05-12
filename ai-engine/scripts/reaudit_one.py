"""Re-audit a single repo (clear cache + run V4 + report).

Usage: python scripts/reaudit_one.py <repo_url>
"""
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_AI_ENGINE_DIR))

from dotenv import load_dotenv
load_dotenv(_AI_ENGINE_DIR / ".env")

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import app.database as appdb
appdb.DATABASE_URL = os.environ["DATABASE_URL"]
appdb.engine = create_engine(appdb.DATABASE_URL)
appdb.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=appdb.engine)

from app.services.v4_shadow_runner import run_v4_cached

DHRUV_USERNAME = "dhruv0206"


async def main():
    if len(sys.argv) < 2:
        print("usage: reaudit_one.py <repo_url>")
        sys.exit(1)
    repo_url = sys.argv[1]
    SessionLocal = appdb.SessionLocal

    print(f"REAUDIT {repo_url}")

    # Clear caches
    with SessionLocal() as s:
        t1 = s.execute(text("DELETE FROM audit_v4_code_cache WHERE repo_url = :u"),
                       {"u": repo_url}).rowcount or 0
        t2 = s.execute(text("DELETE FROM audit_v4_cache WHERE repo_url = :u AND applicant_username = :a"),
                       {"u": repo_url, "a": DHRUV_USERNAME}).rowcount or 0
        s.commit()
        print(f"  cleared: tier1={t1}  tier2={t2}")

    t0 = time.monotonic()
    payload = await run_v4_cached(
        repo_url, github_username=DHRUV_USERNAME,
        db_session_factory=SessionLocal,
        run_full_pipeline=True, enable_verify=False,
    )
    elapsed = time.monotonic() - t0
    print(f"  V4 ran in {elapsed:.1f}s")

    v4 = payload.get("v4_output") or {}
    sb = v4.get("score_breakdown") or {}
    print(f"  score={v4.get('repo_score')}  tier={v4.get('repo_tier')}  discipline={v4.get('discipline')}")
    print(f"  features={sb.get('features',{}).get('score')}/40  "
          f"arch={sb.get('architecture',{}).get('score')}/15  "
          f"intent={sb.get('intent_and_standards',{}).get('score')}/25  "
          f"forensics={sb.get('forensics',{}).get('score')}/20")
    print(f"  ownership_score={v4.get('ownership_score')}  audited_at={v4.get('audited_at')}")
    own_ev = (payload.get("ownership") or {}).get("evidence") or {}
    burst = own_ev.get("burst_severity")
    if burst:
        print(f"  burst_severity={burst}  concentration={own_ev.get('burst_concentration')}  span_days={own_ev.get('burst_timespan_days')}")


if __name__ == "__main__":
    asyncio.run(main())
