"""Create a real hackathon event.

Edit the CONFIG block, then run from ai-engine root:
    .\\venv\\Scripts\\activate
    python scripts/create_hackathon.py

Prints the event URL + access_code at the end. Email those to the organizer.
"""

import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ============================================================================
# EDIT EVERYTHING IN THIS BLOCK FOR EACH NEW EVENT
# ============================================================================

CONFIG = {
    # URL slug — lowercase alphanumeric + hyphens, 3-80 chars.
    # The public URL becomes /hackathons/<slug>
    "slug": "mit-hack-sept-2026",

    # Public display name
    "name": "MIT Hack September 2026",
    "description": "MIT's flagship 36-hour hackathon. AI-verified judging via DevProof.",

    # GitHub username of the person who owns this event on DevProof.
    # They MUST already have signed in to DevProof at least once (so a row in
    # the "user" table exists). We look them up by githubUsername.
    "organizer_github_username": "dhruv0206",

    # Event window — all UTC.
    "starts_at":            datetime(2026, 9, 12, 18, 0, tzinfo=timezone.utc),
    "submissions_close_at": datetime(2026, 9, 14, 12, 0, tzinfo=timezone.utc),
    "judging_starts_at":    datetime(2026, 9, 14, 14, 0, tzinfo=timezone.utc),
    "ends_at":              datetime(2026, 9, 14, 20, 0, tzinfo=timezone.utc),

    # Settings — what extras participants must / can fill in on /submit.
    # Field key -> rendered label is in SubmitForm.tsx EXTRA_FIELD_LABELS.
    "settings": {
        "skip_authorship_check": True,   # hackathon mode
        "skip_forensics": True,          # hackathon mode
        "extras_required": ["deployed_url", "demo_video_url"],
        "extras_optional": ["slide_deck_url", "tech_stack_tags"],
        "max_team_size": 4,
        "rules_text": (
            "Build something real in 36 hours. "
            "All code must be committed during the event window. "
            "Any AI-assisted code must be acknowledged in your README."
        ),
    },

    # Sponsors — `packages` are the npm/pip names the V4 audit will detect
    # in the repo's imports. `prize` is the dollar string shown in the UI.
    "sponsors": [
        {"name": "Resend",  "packages": ["resend", "@resend/node"], "prize": "$2,000"},
        {"name": "Convex",  "packages": ["convex"],                 "prize": "$1,500"},
        {"name": "Inngest", "packages": ["inngest"],                "prize": "$1,000"},
    ],
}

# ============================================================================
# Implementation — usually no need to touch below
# ============================================================================

def _generate_access_code() -> str:
    return secrets.token_urlsafe(24)[:32]


def main() -> None:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set in .env")
        sys.exit(1)

    engine = create_engine(db_url)
    cfg = CONFIG

    with engine.begin() as conn:
        # 1. Look up organizer user_id
        row = conn.execute(
            text('SELECT id, name FROM "user" WHERE "githubUsername" = :u'),
            {"u": cfg["organizer_github_username"]},
        ).fetchone()
        if not row:
            print(
                f"ERROR: no DevProof user with githubUsername="
                f"{cfg['organizer_github_username']!r}.\n"
                "  -> Have them sign in to https://devproof.app once first."
            )
            sys.exit(1)
        organizer_id, organizer_name = row[0], row[1]
        print(f"Organizer: {organizer_name} ({organizer_id})")

        # 2. Refuse if slug already taken
        existing = conn.execute(
            text("SELECT id FROM hackathon WHERE slug = :s"),
            {"s": cfg["slug"]},
        ).fetchone()
        if existing:
            print(f"ERROR: slug '{cfg['slug']}' already exists.")
            print("  -> Either pick a different slug, or DELETE the old row first.")
            sys.exit(1)

        # 3. Generate codes (participant for /join, organizer for /admin)
        access_code = _generate_access_code()
        organizer_access_code = _generate_access_code()

        # 4. Insert event row
        import json
        hackathon_id = conn.execute(
            text("""
                INSERT INTO hackathon (
                    slug, name, description, organizer_user_id,
                    access_code, organizer_access_code,
                    starts_at, submissions_close_at, judging_starts_at, ends_at,
                    settings_json, sponsors_json
                ) VALUES (
                    :slug, :name, :description, :organizer_user_id,
                    :access_code, :organizer_access_code,
                    :starts_at, :submissions_close_at, :judging_starts_at, :ends_at,
                    CAST(:settings AS jsonb), CAST(:sponsors AS jsonb)
                )
                RETURNING id
            """),
            {
                "slug": cfg["slug"],
                "name": cfg["name"],
                "description": cfg["description"],
                "organizer_user_id": organizer_id,
                "access_code": access_code,
                "organizer_access_code": organizer_access_code,
                "starts_at": cfg["starts_at"],
                "submissions_close_at": cfg["submissions_close_at"],
                "judging_starts_at": cfg["judging_starts_at"],
                "ends_at": cfg["ends_at"],
                "settings": json.dumps(cfg["settings"]),
                "sponsors": json.dumps(cfg["sponsors"]),
            },
        ).scalar()

        # 5. Make organizer an organizer
        conn.execute(
            text(
                "INSERT INTO hackathon_role (hackathon_id, user_id, role) "
                "VALUES (:h, :u, 'organizer')"
            ),
            {"h": hackathon_id, "u": organizer_id},
        )

    print()
    print("=" * 70)
    print(f"  DONE — '{cfg['name']}' is live")
    print("=" * 70)
    print(f"  slug:                  {cfg['slug']}")
    print(f"  participant code:      {access_code}")
    print(f"  organizer admin code:  {organizer_access_code}")
    print()
    print("URLs to share with the organizer:")
    print(f"  Event:  https://devproof.app/hackathons/{cfg['slug']}")
    print(f"  Admin:  https://devproof.app/hackathons/{cfg['slug']}/admin")
    print(f"  Join:   https://devproof.app/hackathons/{cfg['slug']}/join")
    print()
    print("Local URLs for testing:")
    print(f"  http://localhost:3000/hackathons/{cfg['slug']}")
    print(f"  http://localhost:3000/hackathons/{cfg['slug']}/admin")
    print(f"  http://localhost:3000/hackathons/{cfg['slug']}/join")


if __name__ == "__main__":
    main()
