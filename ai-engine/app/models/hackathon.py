"""Hackathon platform models.

Three tables:

  * ``hackathon`` — event metadata, sponsors, settings
  * ``hackathon_role`` — many-to-many between User and Hackathon with role
    (organizer / judge / participant)
  * ``hackathon_submission`` — one row per submitter team per event,
    referencing the underlying Project audited

A submission **is** a Project (existing model). We don't duplicate the
GitHub URL or audit machinery — we link to the existing project_id.
The audit pipeline runs in `hackathon_mode` (set via the corresponding
flag on the Hackathon row's settings_json).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import (
    Column, String, JSON, DateTime, Index, Integer, ForeignKey, Boolean,
    Numeric, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class HackathonRoleType(str, Enum):
    ORGANIZER = "organizer"     # full event admin — settings, awards, invites, publish
    JUDGE = "judge"             # read submissions + score
    OBSERVER = "observer"       # read-only (sponsors who want visibility)
    PARTICIPANT = "participant" # can submit + be on a team


class SubmissionStatus(str, Enum):
    DRAFT = "draft"            # being edited
    SUBMITTED = "submitted"    # locked at deadline
    WITHDRAWN = "withdrawn"    # dev pulled it before deadline


class AuditStatus(str, Enum):
    PENDING = "pending"        # not yet started
    RUNNING = "running"        # BackgroundTasks dispatched
    COMPLETE = "complete"      # repo_score available
    FAILED = "failed"          # error, see audit_error


# ─── Hackathon ────────────────────────────────────────────────────────────────

class Hackathon(Base):
    __tablename__ = "hackathon"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    slug = Column(String(80), nullable=False, unique=True)
    name = Column(String(200), nullable=False)
    description = Column(String, nullable=True)

    # Organizer (the user who created this event). HackathonRole rows control
    # downstream access; this is just for "owner of the event."
    organizer_user_id = Column(String, ForeignKey("user.id"), nullable=False)

    # Lifecycle dates (UTC)
    starts_at = Column(DateTime, nullable=True)
    submissions_close_at = Column(DateTime, nullable=True)  # default 4-6h before judging
    judging_starts_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)

    # Organizer-controlled manual lock. Combined with submissions_close_at via
    # OR: a submission is editable iff override=False AND now <= close_at.
    # Lets the organizer instantly freeze submissions (e.g. "judging starts NOW")
    # without waiting for the scheduled close, or extend by unsetting + bumping
    # close_at.
    submissions_locked_override = Column(
        Boolean, nullable=False, default=False, server_default="false",
    )

    # Single shared join code per event. Per-participant codes are v2.
    access_code = Column(String(32), nullable=False, unique=True)

    # Code-based admin access for non-dev organizers (no GitHub OAuth needed).
    # Pasting this on /hackathons/{slug}/admin/login sets a 30-day cookie that
    # grants the same access as the GitHub-authed organizer role. Nullable for
    # rows created before this column existed.
    organizer_access_code = Column(String(64), nullable=True, unique=True)

    # JSON config bag — keeps schema flexible during MVP iteration:
    #   {
    #     "skip_authorship_check": true,
    #     "skip_forensics": true,
    #     "extras_required": ["deployed_url", "demo_video_url", "description"],
    #     "extras_optional": ["slide_deck_url", "tech_stack_tags"],
    #     "max_team_size": null,    # null = no system cap
    #     "rules_text": "..."
    #   }
    settings_json = Column(JSON, nullable=False, default=dict)

    # Per-event sponsor list (NOT a precompiled catalog). Shape:
    #   [
    #     {"name": "Resend", "packages": ["resend", "@resend/node"], "prize": "$2k"},
    #     {"name": "Convex", "packages": ["convex", "@convex-dev/auth"]},
    #     ...
    #   ]
    sponsors_json = Column(JSON, nullable=False, default=list)

    # Leaderboard publishing toggle. None = not yet published.
    published_at = Column(DateTime, nullable=True)

    # Shareable single-link judge access. Anyone with this token can open
    # /hackathons/{slug}/judge/{token}, type their name, and score
    # submissions — no DevProof account required. Designed for sponsors /
    # community judges who aren't DevProof users. None = no link issued
    # yet (organizer hasn't clicked "Generate judge link"). Regenerating
    # replaces the value, immediately invalidating the previous link.
    judge_link_token = Column(String, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        Index("ix_hackathon_slug", "slug"),
        Index("ix_hackathon_organizer", "organizer_user_id"),
    )


# ─── HackathonRole ────────────────────────────────────────────────────────────

class HackathonRole(Base):
    """Many-to-many between User and Hackathon with role.

    A single user can have at most one role per hackathon — we enforce
    via unique constraint. Roles:
      - organizer: full admin (settings, awards, exports, publish)
      - judge: read submissions + comment, no settings
      - participant: can submit / be on a team
    """
    __tablename__ = "hackathon_role"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    hackathon_id = Column(UUID(as_uuid=True), ForeignKey("hackathon.id"), nullable=False)
    user_id = Column(String, ForeignKey("user.id"), nullable=False)
    role = Column(String(20), nullable=False)  # 'organizer' | 'judge' | 'participant'

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("hackathon_id", "user_id", name="uq_hackathon_role_user"),
        Index("ix_hackathon_role_hackathon", "hackathon_id"),
        Index("ix_hackathon_role_user", "user_id"),
    )


# ─── HackathonSubmission ──────────────────────────────────────────────────────

class HackathonSubmission(Base):
    """One submission per submitter+event. Links to an existing Project row."""
    __tablename__ = "hackathon_submission"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    hackathon_id = Column(UUID(as_uuid=True), ForeignKey("hackathon.id"), nullable=False)
    submitter_user_id = Column(String, ForeignKey("user.id"), nullable=False)

    # The audited project. Nullable because we create the submission row
    # first, then create the Project + ProjectAudit when the form is filled.
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)

    # Submission content
    github_url = Column(String, nullable=False)
    extras_json = Column(JSON, nullable=False, default=dict)
    # Shape: {
    #   "deployed_url": "https://...",
    #   "demo_video_url": "https://youtu.be/...",
    #   "slide_deck_url": "https://...",
    #   "description": "...",
    #   "tech_stack_tags": ["python", "react"],
    #   "problem_statement": "..."
    # }

    # First-class submission fields (added 2026-05-17). Previously inferred
    # from extras_json — promoted for validation + indexability.
    tagline = Column(String(140), nullable=True)            # one-line pitch
    what_it_does = Column(String(500), nullable=True)       # paragraph for judges
    demo_url = Column(String(500), nullable=True)           # deployed app URL
    team_name = Column(String(80), nullable=True)           # null = solo submission

    # Sponsor names this team has opted OUT of competing for (hybrid track
    # model: auto-detected sponsors apply by default; team can exclude
    # specific ones — e.g. "we used Stripe for auth, don't put us on the
    # Stripe leaderboard"). Shape: ["Stripe", "OpenAI"].
    tracks_opted_out_json = Column(
        JSON, nullable=False, default=list, server_default="[]",
    )

    # Legacy free-text teammate display list (GitHub usernames). Kept for
    # backwards compat; new structured invites flow through HackathonTeamMember.
    team_members_json = Column(JSON, nullable=False, default=list)

    # Sponsors matched against this submission's audit (cross-reference of
    # claim.sdk_packages_used vs hackathon.sponsors_json[].packages).
    # Computed at audit-complete time. Shape: {sponsor_name: [claim_ids...]}.
    matched_sponsors_json = Column(JSON, nullable=False, default=dict)

    # Status fields
    submission_status = Column(String(20), nullable=False, default=SubmissionStatus.DRAFT.value)
    audit_status = Column(String(20), nullable=False, default=AuditStatus.PENDING.value)
    audit_error = Column(String, nullable=True)

    # Dev-controlled flag: pin this finished hackathon to my public profile
    # (/p/<username>). Only meaningful once audit_status='complete'.
    pinned_to_profile = Column(Boolean, nullable=False, default=False, server_default="false")

    submitted_at = Column(DateTime, nullable=True)
    withdrawn_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        # One submission per submitter per hackathon (decision #2 from plan).
        UniqueConstraint(
            "hackathon_id", "submitter_user_id",
            name="uq_hackathon_submission_per_dev",
        ),
        Index("ix_hackathon_submission_hackathon", "hackathon_id"),
        Index("ix_hackathon_submission_submitter", "submitter_user_id"),
        Index("ix_hackathon_submission_audit_status", "audit_status"),
    )


# ─── HackathonInvite ──────────────────────────────────────────────────────────

class HackathonInvite(Base):
    """Magic-link invitations to grant a HackathonRole.

    The invite token is the *only* credential needed to claim the role —
    once accepted, the recipient gets a normal hackathon_role row and uses
    their regular DevProof session for subsequent access. Tokens are
    single-use, expire (default 7 days), and revocable.

    Multi-admin & multi-hackathon both fall out of this design:
      * Multi-admin: invite many users to the same hackathon
      * Multi-hackathon: a user already on event A can be invited to event B
        without changing their existing role on A
    """
    __tablename__ = "hackathon_invite"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    hackathon_id = Column(UUID(as_uuid=True), ForeignKey("hackathon.id"), nullable=False)
    invited_email = Column(String, nullable=True)              # optional; null = "anyone with link"
    invited_by = Column(String, ForeignKey("user.id"), nullable=False)
    role = Column(String(32), nullable=False)                  # HackathonRoleType.value

    token = Column(String, nullable=False, unique=True)        # 32-char base64
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)                  # single-use marker
    accepted_by = Column(String, ForeignKey("user.id"), nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by = Column(String, ForeignKey("user.id"), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        Index("ix_hackathon_invite_token", "token"),
        Index("ix_hackathon_invite_hackathon", "hackathon_id"),
        Index("ix_hackathon_invite_email", "invited_email"),
    )

    @property
    def is_active(self) -> bool:
        """True if the invite can still be accepted."""
        now = datetime.now(timezone.utc)
        # SQLAlchemy returns naive datetimes for TIMESTAMPTZ in some configs;
        # normalize both sides for safe comparison.
        expires = self.expires_at
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return (
            self.used_at is None
            and self.revoked_at is None
            and (expires is None or expires > now)
        )

    @property
    def status(self) -> str:
        """Human-readable status for UI display."""
        if self.revoked_at is not None:
            return "revoked"
        if self.used_at is not None:
            return "accepted"
        now = datetime.now(timezone.utc)
        expires = self.expires_at
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires is not None and expires <= now:
            return "expired"
        return "pending"


# ─── HackathonJudgeScore ──────────────────────────────────────────────────────

class HackathonJudgeScore(Base):
    """One row per (submission, judge_name). Judges authenticate by typing
    their name + holding a valid hackathon.judge_link_token URL — no
    DevProof account needed. The UNIQUE (submission_id, judge_name)
    constraint means re-saving from the same judge upserts in place,
    so a judge can edit their score/notes without spawning duplicates.
    """
    __tablename__ = "hackathon_judge_score"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    hackathon_id = Column(UUID(as_uuid=True), ForeignKey("hackathon.id"), nullable=False)
    submission_id = Column(UUID(as_uuid=True), ForeignKey("hackathon_submission.id"), nullable=False)

    # Free-text judge identity. Trimmed + length-capped at the app layer
    # (request validation). No FK to user — judges may not be DevProof
    # users at all.
    judge_name = Column(String, nullable=False)

    # 0.0-10.0 with optional decimal. Nullable so a judge can leave notes
    # without committing a score (and vice versa). NUMERIC(4,1) in DB.
    score = Column(Numeric(4, 1), nullable=True)

    notes = Column(String, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "submission_id", "judge_name",
            name="uq_judge_score_submission_judge",
        ),
        Index("ix_judge_score_submission", "submission_id"),
        Index("ix_judge_score_hackathon", "hackathon_id"),
    )


# ─── HackathonTeamMember ──────────────────────────────────────────────────────

class TeamMemberStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REVOKED = "revoked"


class HackathonTeamMember(Base):
    """Invite-based teammate record. One row per invitation.

    A teammate is invited via username OR email. On accept, the teammate
    gains full edit rights on the submission (same as the submitter) AND
    the parent hackathon surfaces on their personal /me/hackathons view.

    Lifecycle: pending -> accepted | declined | revoked. Expiry is enforced
    at the application layer via expires_at comparison. Revocation is
    organizer/submitter-initiated; declined is invitee-initiated; accepted
    is the happy path that grants edit access.
    """
    __tablename__ = "hackathon_team_member"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    submission_id = Column(
        UUID(as_uuid=True), ForeignKey("hackathon_submission.id"), nullable=False,
    )

    # Identifier captured at invite time. Either one is set (CHECK constraint
    # enforced in DB).
    invited_user_id = Column(String, ForeignKey("user.id"), nullable=True)
    invited_email = Column(String, nullable=True)

    # Resolved on accept. For username invites this matches invited_user_id;
    # for email invites it's populated when the recipient signs in.
    accepted_user_id = Column(String, ForeignKey("user.id"), nullable=True)

    invite_token = Column(String, nullable=False, unique=True)
    status = Column(String(16), nullable=False, default=TeamMemberStatus.PENDING.value)

    invited_by = Column(String, ForeignKey("user.id"), nullable=False)
    invited_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False,
    )
    accepted_at = Column(DateTime, nullable=True)
    declined_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("ix_team_member_submission", "submission_id"),
        Index("ix_team_member_accepted_user", "accepted_user_id"),
        Index("ix_team_member_token", "invite_token"),
        Index("ix_team_member_invited_user", "invited_user_id"),
        Index("ix_team_member_invited_email", "invited_email"),
    )

    @property
    def is_active(self) -> bool:
        """Pending and not yet expired."""
        if self.status != TeamMemberStatus.PENDING.value:
            return False
        expires = self.expires_at
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return expires is None or expires > datetime.now(timezone.utc)


__all__ = [
    "Hackathon",
    "HackathonRole",
    "HackathonRoleType",
    "HackathonSubmission",
    "HackathonInvite",
    "HackathonJudgeScore",
    "HackathonTeamMember",
    "TeamMemberStatus",
    "SubmissionStatus",
    "AuditStatus",
]
