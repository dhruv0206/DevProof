"""Apply the pinned_to_profile migration."""
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
SQL = (Path(__file__).resolve().parent.parent / "app" / "models" / "hackathon_pin_migration.sql").read_text(encoding="utf-8")

engine = create_engine(os.environ["DATABASE_URL"])
with engine.begin() as conn:
    conn.exec_driver_sql(SQL)
    cnt = conn.execute(text("SELECT COUNT(*) FROM hackathon_submission")).scalar()
print(f"Migration applied. {cnt} hackathon_submission row(s) defaulted to pinned_to_profile=false.")
