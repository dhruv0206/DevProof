"""One-shot bootstrap for local hackathon testing.

Runs the migration SQL, looks up Dhruv's user_id by GitHub username,
inserts a test hackathon ("test-hack-2026" / access_code "TEST-CODE-123"),
and inserts an organizer role row.

Idempotent: re-running drops and recreates the test event.

Usage:
    cd D:\\Projects\\github-contributions-search\\ai-engine
    .\\venv\\Scripts\\activate
    python scripts/setup_test_hackathon.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Load .env from ai-engine root
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in .env")
    sys.exit(1)

GITHUB_USERNAME = "dhruv0206"
SLUG = "test-hack-2026"
ACCESS_CODE = "TEST-CODE-123"

MIGRATION_SQL = (Path(__file__).resolve().parent.parent / "app" / "models" / "hackathon_migration.sql").read_text(encoding="utf-8")

engine = create_engine(DATABASE_URL)

with engine.begin() as conn:
    print("[1/4] Running migration SQL...")
    # Run as a single batch — Postgres handles multiple statements via psycopg2.
    conn.exec_driver_sql(MIGRATION_SQL)
    print("      Tables ensured: hackathon, hackathon_role, hackathon_submission")

    print(f'[2/4] Looking up user "{GITHUB_USERNAME}"...')
    row = conn.execute(
        text('SELECT id, name FROM "user" WHERE "githubUsername" = :u'),
        {"u": GITHUB_USERNAME},
    ).fetchone()
    if not row:
        print(f"      ERROR: no user row with githubUsername={GITHUB_USERNAME}")
        sys.exit(1)
    user_id = row[0]
    print(f"      Found {row[1]} -> {user_id}")

    print("[3/4] Removing any prior test event with same slug...")
    conn.execute(text("DELETE FROM hackathon WHERE slug = :s"), {"s": SLUG})
    print("      Cleaned.")

    print("[4/4] Inserting test hackathon + organizer role...")
    hackathon_id = conn.execute(
        text("""
            INSERT INTO hackathon (
                slug, name, description, organizer_user_id, access_code,
                starts_at, submissions_close_at, judging_starts_at, ends_at,
                settings_json, sponsors_json
            ) VALUES (
                :slug, :name, :description, :organizer_user_id, :access_code,
                NOW() - INTERVAL '1 hour',
                NOW() + INTERVAL '24 hours',
                NOW() + INTERVAL '24 hours',
                NOW() + INTERVAL '48 hours',
                CAST(:settings AS jsonb),
                CAST(:sponsors AS jsonb)
            )
            RETURNING id
        """),
        {
            "slug": SLUG,
            "name": "Test Hack 2026",
            "description": "Local test event",
            "organizer_user_id": user_id,
            "access_code": ACCESS_CODE,
            "settings": '{"skip_authorship_check": true, "skip_forensics": true, "extras_required": ["deployed_url"], "extras_optional": ["demo_video_url", "tech_stack_tags"], "max_team_size": null, "rules_text": "Be cool."}',
            "sponsors": '[{"name": "Resend", "packages": ["resend"], "prize": "$2k"}, {"name": "Convex", "packages": ["convex"], "prize": "$1k"}]',
        },
    ).scalar()

    conn.execute(
        text("INSERT INTO hackathon_role (hackathon_id, user_id, role) VALUES (:h, :u, 'organizer')"),
        {"h": hackathon_id, "u": user_id},
    )

print()
print("DONE.")
print(f"  slug:        {SLUG}")
print(f"  access_code: {ACCESS_CODE}")
print(f"  organizer:   {GITHUB_USERNAME} ({user_id})")
print()
print("Next:")
print("  1. Restart backend  (uvicorn app.main:app --reload --port 8000)")
print("  2. Visit            http://localhost:3000/hackathons/test-hack-2026")
print("  3. As organizer     http://localhost:3000/hackathons/test-hack-2026/admin")
print("  4. As participant   open in private window, sign in with another GitHub account,")
print(f"                       go to /hackathons/test-hack-2026/join, paste {ACCESS_CODE}")
