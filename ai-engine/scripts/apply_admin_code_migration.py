"""Apply the organizer_access_code migration + show the codes for any
existing hackathons so you can email them to the organizer."""

import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SQL = (Path(__file__).resolve().parent.parent / "app" / "models" / "hackathon_admin_code_migration.sql").read_text(encoding="utf-8")

engine = create_engine(os.environ["DATABASE_URL"])
with engine.begin() as conn:
    conn.exec_driver_sql(SQL)
    rows = conn.execute(text(
        "SELECT slug, name, access_code, organizer_access_code "
        "FROM hackathon ORDER BY created_at"
    )).fetchall()

print()
print("Migration applied. Current event codes:")
print("-" * 70)
for slug, name, ac, oac in rows:
    print(f"  {slug}  ({name})")
    print(f"    participant code: {ac}")
    print(f"    organizer  code: {oac}")
    print()
