"""Hackathon-side audit view assembly.

PURE READ-SIDE — never mutates the algo, never writes to the DB.

The DevProof V4 pipeline (in `devproof_ranking_algo`) produces a V4Output
JSON blob that's stored on every Project's audit row. The dev-facing
DevProof UI consumes that blob directly via ``ProjectDetailPanel`` and
friends. For the hackathon admin / judging surfaces we want the same
claim-level evidence + architecture + skills + forensics — without
re-running the audit, and without touching the algo.

This file is the "read-side adapter": given a HackathonSubmission + its
ProjectAudit row + the parent Hackathon, return a single unified payload
the frontend can render. Sponsor-evidence enrichment is gated on the
hackathon's `show_sponsor_evidence` setting (organizer toggle); when
off, the response shape is identical except sponsor specifics are
omitted.

If the algo ever changes its V4Output schema, this file is the only
place that has to adapt — no algo changes needed here, and no risk of
contaminating the algo's developer-facing path.
"""

from __future__ import annotations

import re
from typing import Any, Optional

# Minimum length for a name-only variant to be a matchable needle. 4 chars
# blocks generic substrings like "AI"/"API" and keeps false positives rare
# while still accepting most brand names ("Convex", "Neon", "Hugo", etc.).
_NAME_MIN_LEN = 4


def _v4_output_dict(audit: Any) -> dict[str, Any]:
    """Extract the V4 output JSON blob from a ProjectAudit row.

    ProjectAudit.v4_output is stored as JSON; SQLAlchemy may return it
    as either a dict (already parsed) or a string (raw). Normalize.
    Returns an empty dict if absent / malformed.
    """
    if audit is None:
        return {}
    raw = getattr(audit, "v4_output", None)
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    # Defensive: some configurations return JSON as string.
    try:
        import json as _json
        return _json.loads(raw)
    except Exception:
        return {}


def hackathon_adjusted_score(
    v4_output: dict[str, Any],
    settings: Optional[dict[str, Any]],
) -> Optional[int]:
    """Compute the hackathon-side audit score.

    When the hackathon's ``skip_forensics`` setting is True (the default
    for every hackathon — see ``HackathonSettingsIn``), the headline
    score for judges and leaderboards excludes the FORENSICS bucket.
    Hackathon submissions are typically a single push: no iterated
    commit history, often a single author. Penalizing them on
    forensics — designed to weigh production / portfolio code — is the
    wrong rubric.

    The three remaining buckets — FEATURES (50), ARCHITECTURE (19),
    INTENT_AND_STANDARDS (31) — sum to exactly 100, so the adjusted
    score is naturally a /100 number and lines up with how judges
    already think about the headline.

    Returns:
        - int in [0, 100] when skip_forensics is on and the breakdown
          contains the three required buckets.
        - None when skip_forensics is off (caller should fall back to
          v4_score), or when the breakdown is missing/malformed.
    """
    s = settings or {}
    # Default-True matches HackathonSettingsIn; preserved here so missing
    # settings_json still triggers the adjusted-score path.
    if not s.get("skip_forensics", True):
        return None
    breakdown = (v4_output or {}).get("score_breakdown") or {}
    if not isinstance(breakdown, dict):
        return None
    total: float = 0.0
    found_any = False
    for k in ("features", "architecture", "intent_and_standards"):
        bucket = breakdown.get(k)
        if isinstance(bucket, dict):
            score = bucket.get("score")
            if isinstance(score, (int, float)):
                total += float(score)
                found_any = True
    if not found_any:
        return None
    return int(round(total))


def build_admin_submission_view(
    submission: Any,
    audit: Any,
    hackathon: Any,
) -> dict[str, Any]:
    """Build the unified payload for the hackathon admin submission-detail
    page. Includes the full V4 audit output verbatim, plus (when the
    organizer has enabled ``show_sponsor_evidence``) per-sponsor file:line
    evidence computed from the same V4 output.

    Args:
        submission: HackathonSubmission row.
        audit: ProjectAudit row (or None if audit hasn't run yet).
        hackathon: Hackathon row.

    Returns:
        Dict with keys: submission (meta), audit (v4 output verbatim),
        sponsor_evidence (only when toggle is on, else None).
    """
    v4 = _v4_output_dict(audit)

    settings = hackathon.settings_json or {}
    show_sponsor_evidence = bool(settings.get("show_sponsor_evidence"))

    sponsor_evidence: Optional[dict[str, Any]] = None
    if show_sponsor_evidence:
        sponsor_evidence = compute_sponsor_evidence(
            v4_output=v4,
            sponsors=hackathon.sponsors_json or [],
        )

    return {
        "submission": {
            "submission_id": str(submission.id),
            "submitter_user_id": submission.submitter_user_id,
            "github_url": submission.github_url,
            "team_members": submission.team_members_json or [],
            "extras": submission.extras_json or {},
            "matched_sponsors": submission.matched_sponsors_json or {},
            "submission_status": submission.submission_status,
            "audit_status": submission.audit_status,
            "audit_error": submission.audit_error,
            "submitted_at": _iso(submission.submitted_at),
        },
        "audit": {
            # V4 score + tier surface in project_audits columns
            "v4_score": _get_audit_attr(audit, "v4_score"),
            "v4_tier": _get_audit_attr(audit, "v4_tier"),
            # Hackathon-adjusted score: excludes forensics when the
            # hackathon's skip_forensics setting is on (the default).
            # The headline judges + leaderboards read.
            "hackathon_adjusted_score": hackathon_adjusted_score(v4, settings),
            # The full V4Output blob — features, architecture, skills,
            # forensics, score_breakdown, etc. Same shape the dev side
            # consumes via ProjectDetailPanel.
            "v4_output": v4,
            "complexity_tier": _get_audit_attr(audit, "complexity_tier"),
        },
        "show_sponsor_evidence": show_sponsor_evidence,
        "sponsor_evidence": sponsor_evidence,
    }


def compute_sponsor_evidence(
    v4_output: dict[str, Any],
    sponsors: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """For each configured sponsor, return the list of V4 claims that
    used any of its packages, with file:line evidence.

    Matching strategies (one per sponsor, picked by what the organizer
    provided):

      • ``packages`` present → exact match on ``claim.sdk_packages_used``
        (lowercased equality). This is the precise path — surgical, no
        false positives.
      • ``packages`` empty   → whole-word match of the sponsor's *name*
        against each import in ``sdk_packages_used``. Lets organizers
        add a sponsor without knowing npm names. Names shorter than 4
        chars (e.g. "AI") are skipped to keep noise out.

    Algo-free: we just walk the v4_output features and cross-reference.
    No scoring, no mutation.

    Returns:
        Dict keyed by sponsor name. Each value is a list of:
        {
          "package": "resend",            # which import matched
          "claim_summary": "...",         # short claim description
          "tier": "TIER_3_DEEP"|None,     # claim's tier
          "feature_type": "CUSTOM"|...    # CUSTOM/COMPLEX/WRAPPER
          "evidence_files": ["src/.."],   # files where it's used
          "evidence_lines": [42, 88, ...] # line numbers
          "match_type": "package"|"name", # how it matched
        }
    """
    # Bucket sponsors by matching strategy.
    pkg_to_sponsor: dict[str, str] = {}
    name_only: list[tuple[str, list[str]]] = []  # (sponsor_name, variants)
    for s in sponsors or []:
        if not isinstance(s, dict):
            continue
        name = s.get("name")
        if not name:
            continue
        pkgs = [
            p.strip().lower()
            for p in (s.get("packages") or [])
            if isinstance(p, str) and p.strip()
        ]
        if pkgs:
            for p in pkgs:
                pkg_to_sponsor[p] = name
        else:
            variants = _name_variants(name)
            if variants:
                name_only.append((name, variants))

    if not pkg_to_sponsor and not name_only:
        return {}

    # Walk every feature/claim in the V4 output.
    by_sponsor: dict[str, list[dict[str, Any]]] = {}
    features = (v4_output or {}).get("features") or (v4_output or {}).get("verified_features") or []
    for claim in features:
        if not isinstance(claim, dict):
            continue
        pkgs = claim.get("sdk_packages_used") or []
        if not isinstance(pkgs, list):
            continue
        for pkg in pkgs:
            if not isinstance(pkg, str):
                continue
            pkg_low = pkg.strip().lower()

            sponsor_name: Optional[str] = pkg_to_sponsor.get(pkg_low)
            match_type = "package"
            if sponsor_name is None:
                for sname, variants in name_only:
                    if _package_matches_name(variants, pkg_low):
                        sponsor_name = sname
                        match_type = "name"
                        break
            if sponsor_name is None:
                continue
            by_sponsor.setdefault(sponsor_name, []).append({
                "package": pkg,
                "claim_summary": claim.get("summary") or claim.get("title") or "",
                "tier": claim.get("tier"),
                "feature_type": claim.get("feature_type"),
                "evidence_files": claim.get("evidence_files") or [],
                "evidence_lines": claim.get("evidence_lines") or [],
                "cross_file": claim.get("cross_file") or False,
                "match_type": match_type,
            })

    return by_sponsor


def compute_name_only_matches(
    v4_output: dict[str, Any],
    sponsors: list[dict[str, Any]],
) -> dict[str, list[str]]:
    """For sponsors with no ``packages`` configured, do name-based matching
    against ``sdk_packages_used`` in the V4 output.

    Returns the same shape as the algo's ``match_sponsors`` —
    ``{sponsor_name: [matched_package_names]}`` — so the audit-time merge
    on the route side is just a dict update.

    Skips sponsors that already have packages (those are handled by the
    algo's exact-match path), and sponsors whose name is too short to
    produce a safe needle.
    """
    name_specs: list[tuple[str, list[str]]] = []
    for s in sponsors or []:
        if not isinstance(s, dict):
            continue
        name = s.get("name")
        if not name:
            continue
        has_pkgs = any(
            isinstance(p, str) and p.strip()
            for p in (s.get("packages") or [])
        )
        if has_pkgs:
            continue
        variants = _name_variants(name)
        if variants:
            name_specs.append((name, variants))
    if not name_specs:
        return {}

    hits: dict[str, set[str]] = {}
    features = (v4_output or {}).get("features") or (v4_output or {}).get("verified_features") or []
    for claim in features:
        if not isinstance(claim, dict):
            continue
        pkgs = claim.get("sdk_packages_used") or []
        if not isinstance(pkgs, list):
            continue
        for pkg in pkgs:
            if not isinstance(pkg, str) or not pkg.strip():
                continue
            for sname, variants in name_specs:
                if _package_matches_name(variants, pkg):
                    hits.setdefault(sname, set()).add(pkg)

    return {k: sorted(v) for k, v in hits.items()}


def _name_variants(sponsor_name: str) -> list[str]:
    """Generate match-needle variants from a free-text sponsor name.

    Produces lowercased forms with spaces collapsed/replaced so a brand
    like "Together AI" matches packages like ``together-ai``,
    ``together_ai``, or ``togetherai``. Variants shorter than
    ``_NAME_MIN_LEN`` are discarded (keeps generic short names from
    matching every package).
    """
    n = (sponsor_name or "").strip().lower()
    if not n:
        return []
    collapsed = re.sub(r"\s+", "", n)
    if len(collapsed) < _NAME_MIN_LEN:
        return []
    variants = {
        n,
        collapsed,
        re.sub(r"\s+", "-", n),
        re.sub(r"\s+", "_", n),
    }
    return [v for v in variants if len(v) >= _NAME_MIN_LEN]


def _package_matches_name(variants: list[str], pkg: str) -> bool:
    """True if any variant matches ``pkg`` as a whole word/segment.

    A "whole-word" match means the needle is bounded by either string
    boundaries or non-alphanumeric chars in the package name. This
    avoids false positives like "stripe" matching "pinstripe", while
    still matching ``@stripe/stripe-js`` and ``stripe-node``.
    """
    pkg_lower = (pkg or "").lower().strip()
    if not pkg_lower or not variants:
        return False
    for needle in variants:
        pattern = r"(?:^|[^a-z0-9])" + re.escape(needle) + r"(?:$|[^a-z0-9])"
        if re.search(pattern, pkg_lower):
            return True
    return False


# ─── helpers ──────────────────────────────────────────────────────────────────

def _get_audit_attr(audit: Any, name: str, default: Any = None) -> Any:
    if audit is None:
        return default
    return getattr(audit, name, default)


def _iso(dt: Any) -> Optional[str]:
    if dt is None:
        return None
    try:
        return dt.isoformat()
    except AttributeError:
        return str(dt)
