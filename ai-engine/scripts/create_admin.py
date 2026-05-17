"""Provision a platform-admin user (email + password).

Platform admins are DevProof staff who manage the hackathon side of the
platform. They sign in at ``/hackathons/admin/login`` with their email
and password — NOT with GitHub OAuth (that's the developer side).

This script writes:
  1. A row in the BetterAuth-managed ``user`` table.
  2. A row in the BetterAuth-managed ``account`` table with
     ``providerId='credential'`` and a scrypt-hashed password.

The hash format matches BetterAuth's own ``hashPassword`` exactly so the
account is indistinguishable from one created via ``signUpEmail``:

    scrypt(NFKC(password), salt_hex_utf8,
           N=16384, r=16, p=1, dkLen=64) → key_bytes
    stored as `{salt_hex}:{key_hex}`

Usage:
    python scripts/create_admin.py --email you@orenda.vision --name "Dhruv"
    # → prompts for password (hidden)

    python scripts/create_admin.py --email you@orenda.vision \\
        --password "..." --name "Dhruv"
    # → non-interactive (CI / scripts only — leaves password in shell history)

Idempotent: if an account already exists for the email, the password is
ROTATED to the new value (use this to reset).
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import os
import secrets
import sys
import unicodedata
import uuid
from datetime import datetime, timezone
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


def _hash_password(password: str) -> str:
    """Return BetterAuth-compatible scrypt hash `{salt_hex}:{key_hex}`.

    Matches better-auth/src/crypto/password.ts byte-for-byte:
      - NFKC-normalize the password
      - 16-byte random salt, hex-encoded
      - scrypt(N=16384, r=16, p=1, dkLen=64), salt passed as UTF-8 bytes
        of the hex string (NOT the raw 16 random bytes)
    """
    salt_hex = secrets.token_bytes(16).hex()
    normalized = unicodedata.normalize("NFKC", password).encode("utf-8")
    # maxmem follows the BetterAuth formula: 128 * N * r * 2 bytes
    key = hashlib.scrypt(
        normalized,
        salt=salt_hex.encode("utf-8"),
        n=16384,
        r=16,
        p=1,
        dklen=64,
        maxmem=128 * 16384 * 16 * 2,
    )
    return f"{salt_hex}:{key.hex()}"


def _ensure_user(db, email: str, name: str | None, platform_admin: bool) -> str:
    """Find or create the user row. Returns user.id.

    When ``platform_admin`` is True, sets ``isPlatformAdmin = TRUE`` on the
    user row (creates with the flag set, or upgrades an existing user).
    """
    row = db.execute(
        text('SELECT id, "isPlatformAdmin" FROM "user" WHERE email = :email LIMIT 1'),
        {"email": email},
    ).first()
    if row is not None:
        existing_id, is_admin = row[0], row[1]
        if platform_admin and not is_admin:
            db.execute(
                text('UPDATE "user" SET "isPlatformAdmin" = TRUE WHERE id = :id'),
                {"id": existing_id},
            )
            print(f"  ↳ user already exists: id={existing_id}; upgraded to platform admin")
        else:
            print(f"  ↳ user already exists: id={existing_id} platform_admin={is_admin}")
        return existing_id

    user_id = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    db.execute(
        text("""
            INSERT INTO "user"
                (id, name, email, "emailVerified", "isPlatformAdmin",
                 "createdAt", "updatedAt")
            VALUES (:id, :name, :email, TRUE, :is_admin, :now, :now)
        """),
        {
            "id": user_id,
            "name": name or email.split("@")[0],
            "email": email,
            "is_admin": platform_admin,
            "now": now,
        },
    )
    print(f"  ↳ created user: id={user_id} email={email} platform_admin={platform_admin}")
    return user_id


def _upsert_credential_account(db, user_id: str, password_hash: str) -> None:
    """Insert or update the credential-provider account row."""
    row = db.execute(
        text("""
            SELECT id FROM account
            WHERE "userId" = :uid AND "providerId" = 'credential'
            LIMIT 1
        """),
        {"uid": user_id},
    ).first()

    now = datetime.now(timezone.utc)
    if row is not None:
        db.execute(
            text("""
                UPDATE account SET password = :pw, "updatedAt" = :now
                WHERE id = :id
            """),
            {"pw": password_hash, "now": now, "id": row[0]},
        )
        print("  ↳ rotated password on existing credential account")
        return

    db.execute(
        text("""
            INSERT INTO account
                (id, "userId", "providerId", "accountId", password,
                 "createdAt", "updatedAt")
            VALUES (:id, :uid, 'credential', :uid, :pw, :now, :now)
        """),
        {
            "id": str(uuid.uuid4()),
            "uid": user_id,
            "pw": password_hash,
            "now": now,
        },
    )
    print("  ↳ created credential account")


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--email", required=True, help="Admin email address")
    p.add_argument("--name", default=None, help="Display name")
    p.add_argument(
        "--password",
        default=None,
        help="Password (omit to be prompted — recommended)",
    )
    p.add_argument(
        "--platform-admin",
        action="store_true",
        help=(
            "Grant platform-owner privileges (isPlatformAdmin=TRUE). "
            "Platform admins see EVERY hackathon at /hackathons/admin, "
            "not just events where they hold an organizer role. Use this "
            "for DevProof staff who need to manage clients' hackathons."
        ),
    )
    args = p.parse_args()

    password = args.password
    if not password:
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm:  ")
        if password != confirm:
            sys.exit("✗ passwords do not match")
    if len(password) < 8:
        sys.exit("✗ password must be at least 8 characters")

    password_hash = _hash_password(password)

    SessionLocal = appdb.SessionLocal
    with SessionLocal() as db:
        print(f"\n→ Provisioning admin: {args.email}")
        user_id = _ensure_user(db, args.email, args.name, args.platform_admin)

        print("\n→ Setting credential password")
        _upsert_credential_account(db, user_id, password_hash)

        db.commit()

    print("\n" + "=" * 72)
    print("  PLATFORM ADMIN PROVISIONED")
    print("=" * 72)
    print(f"  Email:           {args.email}")
    print(f"  User ID:         {user_id}")
    print(f"  Platform admin:  {args.platform_admin}")
    print()
    print("  Sign in at:")
    print("    /hackathons/admin/login")
    print()


if __name__ == "__main__":
    main()
