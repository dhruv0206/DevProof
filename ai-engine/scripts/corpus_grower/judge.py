"""Judge LLM — second-pass rating of V4 audit confidence.

After V4 produces an audit, this judge LLM reads the audit + repo metadata
and rates how confident it is that V4 got it right. Confidence < 0.6 →
flag for human review.

Cheap (~$0.05-0.10 per audit via gemini-3.1-flash-lite).
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

log = logging.getLogger(__name__)

_JUDGE_MODEL = "gemini-3.1-flash-lite"

_RUBRIC = """You are auditing the V4 algorithm's score of a GitHub repository.
V4 produces a 0-100 score across 4 buckets: features (40), architecture (15),
intent_and_standards (25), forensics (20).

Tiers: 0-30 wrapper/edge-case; 30-65 mid-glue; 65-88 senior-infra; 88-100 deep-tech.

Your job: rate confidence 0.0-1.0 that V4's score is approximately correct.

Red flags that should LOWER confidence:
- Score >85 but features/architecture suggest small surface area
- Score >65 with no real complexity in claims
- Claims describe boilerplate / template / generated code as "deep"
- Repo is a curated list (awesome-*), tutorial, or non-code → score should be <30
- AI-scaffold patterns ignored (burst commits, low ownership, no tests)
- Single-author dominance but algo gave full deep-tech score

Green flags that should RAISE confidence:
- Claims cite specific file paths with concrete depth signals
- Score matches what a senior engineer would say after 10 min code review
- Burst detection correctly fired (or correctly didn't)
- Ownership signals are reasonable for repo size

Output ONLY a JSON object with this shape:
{
  "confidence": 0.0-1.0,
  "agrees_with_tier": true/false,
  "concerns": ["short concern 1", "short concern 2"],
  "flag_for_review": true/false
}
"""


def _build_judge_prompt(v4_output: dict[str, Any], repo_url: str) -> str:
    score = v4_output.get("repo_score", "?")
    tier = v4_output.get("repo_tier", "?")
    discipline = v4_output.get("discipline", "?")
    sb = v4_output.get("score_breakdown") or {}
    features = (sb.get("features") or {}).get("score", "?")
    arch = (sb.get("architecture") or {}).get("score", "?")
    intent = (sb.get("intent_and_standards") or {}).get("score", "?")
    forensics = (sb.get("forensics") or {}).get("score", "?")

    claims = v4_output.get("claims") or []
    claim_summary = []
    for c in claims[:8]:
        claim_summary.append(
            f"  - tier={c.get('tier','?')} layer={c.get('layer','?')} "
            f"type={c.get('feature_type','?')}: {(c.get('feature','') or '')[:80]}"
        )

    return f"""{_RUBRIC}

REPO: {repo_url}

V4 AUDIT RESULT:
  Score: {score} / 100
  Tier:  {tier}
  Discipline: {discipline}
  Features:    {features}/40
  Architecture: {arch}/15
  Intent:      {intent}/25
  Forensics:   {forensics}/20

TOP CLAIMS:
{chr(10).join(claim_summary) if claim_summary else '  (none)'}

Output JSON only.
"""


def judge_audit(v4_output: dict[str, Any], repo_url: str) -> dict[str, Any]:
    """Run judge LLM on a V4 audit result. Returns confidence + concerns.

    Returns a default low-confidence flag if the call fails so we never
    silently mark a bad audit as confident.
    """
    try:
        from google import genai
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            return _fallback("no_api_key")
        client = genai.Client(api_key=api_key)
        prompt = _build_judge_prompt(v4_output, repo_url)
        resp = client.models.generate_content(
            model=_JUDGE_MODEL,
            contents=prompt,
        )
        text = (resp.text or "").strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        data = json.loads(text)
        return {
            "confidence": float(data.get("confidence", 0.5)),
            "agrees_with_tier": bool(data.get("agrees_with_tier", True)),
            "concerns": data.get("concerns") or [],
            "flag_for_review": bool(data.get("flag_for_review", False))
                or float(data.get("confidence", 0.5)) < 0.6,
        }
    except Exception as e:  # noqa: BLE001
        log.warning("judge_audit failed for %s: %s", repo_url, e)
        return _fallback(str(e))


def _fallback(reason: str) -> dict[str, Any]:
    return {
        "confidence": 0.5,
        "agrees_with_tier": True,
        "concerns": [f"judge_failed: {reason[:80]}"],
        "flag_for_review": True,
    }
