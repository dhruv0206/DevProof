"""Manually provision a hackathon organizer (DevProof super-admin tool).

Used while we're in pre-revenue mode and don't need a self-serve flow.
Workflow:
    1. A prospect emails us asking to host a hackathon.
    2. We run this script with their email + hackathon details.
    3. Script creates:
         - User account (if email isn't already registered)
         - Hackathon row (if slug isn't taken)
         - HackathonRole row giving them ORGANIZER access
         - HackathonInvite row with a fresh magic-link token
    4. We send the magic link to the prospect. They click it, log in
       (via BetterAuth — GitHub or email/password as supported), accept
       the invite, and land in their hackathon admin dashboard.

Usage:
    python scripts/create_organizer.py \\
        --email elsa@fomo.club \\
        --name "Elsa Bismuth" \\
        --hackathon-slug fomo-munich-2026 \\
        --hackathon-name "FOMO Munich 2026" \\
        --starts-at 2026-06-01 \\
        --ends-at 2026-06-03

Output:
    Magic link URL (paste this into an email to the prospect)
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_AI_ENGINE_DIR))

from dotenv import load_dotenv
load_dotenv(_AI_ENGINE_DIR / ".env")

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import app.database as appdb
appdb.DATABASE_URL = os.environ.get("DATABASE_URL")
if not appdb.DATABASE_URL:
    sys.exit("DATABASE_URL env var is required (set in ai-engine/.env)")
appdb.engine = create_engine(appdb.DATABASE_URL)
appdb.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=appdb.engine)

from app.models.hackathon import (  # noqa: E402
    Hackathon, HackathonInvite, HackathonRole, HackathonRoleType,
)
from app.models.user import User  # noqa: E402


_FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "https://orenda.vision")


def _parse_date(s: str) -> datetime:
    """Accept YYYY-MM-DD or full ISO. Returns UTC-aware datetime."""
    if "T" in s:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    else:
        dt = datetime.strptime(s, "%Y-%m-%d")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _ensure_user(db, email: str, name: str | None) -> User:
    """Find or create a user by email. Returns the User row.

    Organizers don't need GitHub accounts — the magic-link click IS
    their proof of email ownership (standard email-magic-link UX, same
    as Slack/Linear/Notion). We create the user row with
    ``emailVerified=FALSE``; the magic-link POST handler atomically
    flips it to TRUE when the legitimate inbox-owner clicks the link.

    Defense against skeleton-user pre-takeover (the email-collision
    attack where BetterAuth would auto-merge a future GitHub OAuth
    sign-in into this row): BetterAuth's ``accountLinking`` is
    DISABLED in ``web-platform/src/lib/auth.ts``. With linking off, a
    later GitHub OAuth sign-in cannot silently merge into this
    skeleton row — BetterAuth refuses the merge entirely. A user who
    wants to combine their organizer identity with a GitHub developer
    identity must use the explicit "Link GitHub" flow from /settings.
    """
    user = db.query(User).filter(User.email == email).first()
    if user is not None:
        print(f"  ↳ user already exists: id={user.id} email={user.email}")
        return user

    user_id = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    db.execute(
        text("""
            INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
            VALUES (:id, :name, :email, FALSE, :now, :now)
        """),
        {"id": user_id, "name": name or email.split("@")[0], "email": email, "now": now},
    )
    db.flush()
    user = db.query(User).filter(User.id == user_id).first()
    print(f"  ↳ created user: id={user_id} email={email} (emailVerified=FALSE until they accept the magic link)")
    return user


def _ensure_hackathon(
    db, slug: str, name: str, organizer_user_id: str,
    starts_at: datetime | None, ends_at: datetime | None,
) -> Hackathon:
    """Find or create a hackathon by slug. Returns the Hackathon row."""
    existing = db.query(Hackathon).filter(Hackathon.slug == slug).first()
    if existing is not None:
        print(f"  ↳ hackathon already exists: id={existing.id} slug={slug}")
        return existing

    # Default the milestone dates to `ends_at` so the submission window is
    # OPEN until the event ends. Without this, those columns stay NULL and
    # the frontend formats NULL as the Unix epoch → "submissions closed
    # forever" out of the gate. Organizers can edit these later via the
    # event-edit API.
    h = Hackathon(
        id=uuid.uuid4(),
        slug=slug,
        name=name,
        organizer_user_id=organizer_user_id,
        starts_at=starts_at,
        submissions_close_at=ends_at,
        judging_starts_at=ends_at,
        ends_at=ends_at,
        access_code=secrets.token_urlsafe(24),
        organizer_access_code=None,
        settings_json={},
        sponsors_json=[],
        created_at=datetime.now(timezone.utc),
    )
    db.add(h)
    db.flush()
    print(f"  ↳ created hackathon: id={h.id} slug={slug}")
    return h


def _ensure_organizer_role(db, hackathon_id: uuid.UUID, user_id: str) -> None:
    existing = db.query(HackathonRole).filter(
        HackathonRole.hackathon_id == hackathon_id,
        HackathonRole.user_id == user_id,
    ).first()
    if existing is not None:
        if existing.role != HackathonRoleType.ORGANIZER.value:
            existing.role = HackathonRoleType.ORGANIZER.value
            print("  ↳ upgraded existing role to ORGANIZER")
        else:
            print("  ↳ user is already ORGANIZER on this hackathon")
        return
    db.add(HackathonRole(
        hackathon_id=hackathon_id,
        user_id=user_id,
        role=HackathonRoleType.ORGANIZER.value,
    ))
    print("  ↳ assigned ORGANIZER role")


def _create_invite(
    db, hackathon_id: uuid.UUID, slug: str, email: str, invited_by: str,
    expires_in_days: int,
) -> str:
    """Generate a magic-link invite and return the full URL."""
    token = secrets.token_urlsafe(24)
    while db.query(HackathonInvite).filter(HackathonInvite.token == token).first():
        token = secrets.token_urlsafe(24)

    now = datetime.now(timezone.utc)
    inv = HackathonInvite(
        hackathon_id=hackathon_id,
        invited_email=email,
        invited_by=invited_by,
        role=HackathonRoleType.ORGANIZER.value,
        token=token,
        expires_at=now + timedelta(days=expires_in_days),
        created_at=now,
    )
    db.add(inv)
    db.flush()
    return f"{_FRONTEND_BASE_URL}/hackathons/{slug}/invites/{token}"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--email", required=True, help="Organizer's email address")
    p.add_argument("--name", default=None, help="Organizer's display name")
    p.add_argument("--hackathon-slug", required=True, help="URL slug (lowercase, hyphens)")
    p.add_argument("--hackathon-name", required=True, help="Hackathon display name")
    p.add_argument("--starts-at", default=None, help="YYYY-MM-DD or ISO datetime")
    p.add_argument("--ends-at", default=None, help="YYYY-MM-DD or ISO datetime")
    p.add_argument("--invite-expires-days", type=int, default=14, help="Magic link TTL (default 14 days)")
    p.add_argument("--invited-by-user-id", default=None,
                   help="user_id of the DevProof admin granting access (defaults to the organizer themselves; you can pass your own user_id for a clean audit trail)")
    args = p.parse_args()

    starts_at = _parse_date(args.starts_at) if args.starts_at else None
    ends_at = _parse_date(args.ends_at) if args.ends_at else None

    SessionLocal = appdb.SessionLocal
    with SessionLocal() as db:
        print(f"\n→ Provisioning organizer: {args.email}")
        user = _ensure_user(db, args.email, args.name)

        print(f"\n→ Creating hackathon: {args.hackathon_slug}")
        h = _ensure_hackathon(
            db, args.hackathon_slug, args.hackathon_name, user.id,
            starts_at, ends_at,
        )

        print("\n→ Granting ORGANIZER role")
        _ensure_organizer_role(db, h.id, user.id)

        print("\n→ Creating magic-link invite")
        invited_by = args.invited_by_user_id or user.id
        magic_link = _create_invite(
            db, h.id, args.hackathon_slug, args.email,
            invited_by, args.invite_expires_days,
        )

        db.commit()

    print("\n" + "=" * 72)
    print("  ORGANIZER PROVISIONED SUCCESSFULLY")
    print("=" * 72)
    print(f"  Email:        {args.email}")
    print(f"  Hackathon:    {args.hackathon_slug}")
    print(f"  Expires in:   {args.invite_expires_days} days")
    print()
    print("  Magic link (send this to the organizer):")
    print()
    print(f"  {magic_link}")
    print()
    print("=" * 72)
    print("  Suggested email body:")
    print("=" * 72)
    print(f"""
Hi {(args.name or args.email.split('@')[0])},

Your hackathon "{args.hackathon_name}" is set up on DevProof. Click the link
below to sign in and access your organizer dashboard:

  {magic_link}

This link is good for {args.invite_expires_days} days and works only once.
After clicking it, you'll be logged in and can:

  - Invite co-organizers, judges, and observers
  - Configure event settings (rules, sponsors, dates)
  - View live submissions as they come in
  - Publish the leaderboard when the event ends

If you have any questions, reply to this email.

Cheers,
DevProof
""")


if __name__ == "__main__":
    main()
