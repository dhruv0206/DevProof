"""Flip your hackathon role for testing.

    python scripts/swap_role.py <slug> <organizer|participant|judge>

Useful for testing the participant flow when you're already the organizer
on an event. Run it before testing, run it again to flip back. Affects
the hackathon_role row for the GITHUB_USERNAME below — change the
constant if you're swapping for someone else.
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GITHUB_USERNAME = "dhruv0206"
ALLOWED_ROLES = {"organizer", "participant", "judge"}


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: python scripts/swap_role.py <slug> <organizer|participant|judge>")
        sys.exit(2)
    slug, new_role = sys.argv[1], sys.argv[2]
    if new_role not in ALLOWED_ROLES:
        print(f"role must be one of {sorted(ALLOWED_ROLES)}")
        sys.exit(2)

    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.begin() as conn:
        u = conn.execute(
            text('SELECT id FROM "user" WHERE "githubUsername" = :u'),
            {"u": GITHUB_USERNAME},
        ).scalar()
        if not u:
            print(f"no user with githubUsername={GITHUB_USERNAME}")
            sys.exit(1)

        h = conn.execute(
            text("SELECT id, name FROM hackathon WHERE slug = :s"),
            {"s": slug},
        ).fetchone()
        if not h:
            print(f"no hackathon with slug={slug}")
            sys.exit(1)
        hid, hname = h[0], h[1]

        existing = conn.execute(
            text("SELECT role FROM hackathon_role WHERE hackathon_id = :h AND user_id = :u"),
            {"h": hid, "u": u},
        ).scalar()
        if existing:
            conn.execute(
                text("UPDATE hackathon_role SET role = :r "
                     "WHERE hackathon_id = :h AND user_id = :u"),
                {"r": new_role, "h": hid, "u": u},
            )
            print(f"  {hname} ({slug}): {existing} -> {new_role}")
        else:
            conn.execute(
                text("INSERT INTO hackathon_role (hackathon_id, user_id, role) "
                     "VALUES (:h, :u, :r)"),
                {"h": hid, "u": u, "r": new_role},
            )
            print(f"  {hname} ({slug}): (none) -> {new_role}")


if __name__ == "__main__":
    main()
