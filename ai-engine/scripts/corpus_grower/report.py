"""Generate the morning corpus report — markdown summary of audited repos.

Reads from Supabase corpus_silver_tier, produces a markdown file with:
- Overall stats (count, success rate, score distribution)
- Per-tier breakdown
- Per-discovery-source breakdown
- Flagged audits (judge confidence < 0.6)
- Drift from tier_hint (where applicable)
- Surprising patterns
- Per-repo table
"""
from __future__ import annotations

import json
import logging
import os
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

def _get_conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL env var is required (set in ai-engine/.env).")
    return psycopg2.connect(url, connect_timeout=15)


def _fetchall(sql: str, params: tuple = ()) -> list[dict]:
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def _section_overall() -> str:
    total = _fetchall("SELECT COUNT(*) AS c FROM corpus_silver_tier")[0]["c"]
    succeeded = _fetchall("SELECT COUNT(*) AS c FROM corpus_silver_tier WHERE succeeded = TRUE")[0]["c"]
    failed = total - succeeded

    rows = _fetchall(
        "SELECT repo_score FROM corpus_silver_tier WHERE succeeded = TRUE AND repo_score IS NOT NULL"
    )
    scores = [r["repo_score"] for r in rows]

    if scores:
        mean = round(sum(scores) / len(scores), 1)
        median = statistics.median(scores)
        stdev = round(statistics.stdev(scores), 1) if len(scores) > 1 else 0
        smin = min(scores)
        smax = max(scores)
    else:
        mean = median = stdev = smin = smax = "n/a"

    flagged = _fetchall("SELECT COUNT(*) AS c FROM corpus_silver_tier WHERE flagged_for_review = TRUE")[0]["c"]

    return f"""## Overall

- **Total audits:** {total}
- **Succeeded:** {succeeded} ({succeeded*100//total if total else 0}%)
- **Failed:** {failed}
- **Flagged for review:** {flagged} ({flagged*100//total if total else 0}%)

### Score distribution (succeeded only)

| Stat | Value |
|---|---|
| Mean | {mean} |
| Median | {median} |
| StDev | {stdev} |
| Min | {smin} |
| Max | {smax} |
| N | {len(scores)} |
"""


def _section_by_tier() -> str:
    rows = _fetchall("""
        SELECT repo_tier, COUNT(*) AS n, ROUND(AVG(repo_score)::numeric, 1) AS avg_score,
               MIN(repo_score) AS min_s, MAX(repo_score) AS max_s
        FROM corpus_silver_tier
        WHERE succeeded = TRUE AND repo_score IS NOT NULL
        GROUP BY repo_tier ORDER BY avg_score DESC
    """)
    out = ["## Distribution by V4 tier\n\n| Tier | Count | Avg Score | Min | Max |", "|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r['repo_tier']} | {r['n']} | {r['avg_score']} | {r['min_s']} | {r['max_s']} |")
    return "\n".join(out)


def _section_by_source() -> str:
    rows = _fetchall("""
        SELECT discovery_source, COUNT(*) AS n,
               SUM(CASE WHEN succeeded THEN 1 ELSE 0 END) AS ok,
               ROUND(AVG(CASE WHEN succeeded THEN repo_score END)::numeric, 1) AS avg_score,
               SUM(CASE WHEN flagged_for_review THEN 1 ELSE 0 END) AS flagged
        FROM corpus_silver_tier
        GROUP BY discovery_source ORDER BY n DESC
    """)
    out = ["## By discovery source\n\n| Source | Total | Succeeded | Avg Score | Flagged |", "|---|---|---|---|---|"]
    for r in rows:
        out.append(
            f"| {r['discovery_source']} | {r['n']} | {r['ok']} | {r['avg_score']} | {r['flagged']} |"
        )
    return "\n".join(out)


def _section_tier_hint_drift() -> str:
    rows = _fetchall("""
        SELECT repo_url, repo_score, repo_tier, discovery_tier, judge_confidence
        FROM corpus_silver_tier
        WHERE succeeded = TRUE AND repo_score IS NOT NULL
        ORDER BY repo_url
    """)

    # Map tier_hint → expected_score_range (rough)
    tier_ranges = {
        "wrapper": (0, 50),
        "edge-case": (0, 35),
        "mid-glue": (40, 75),
        "senior-infra": (60, 90),
        "deep-tech": (80, 100),
    }
    surprises = []
    for r in rows:
        rng = tier_ranges.get(r["discovery_tier"])
        if not rng:
            continue
        lo, hi = rng
        if r["repo_score"] < lo - 5 or r["repo_score"] > hi + 5:
            delta = (r["repo_score"] - hi) if r["repo_score"] > hi else (r["repo_score"] - lo)
            surprises.append({
                **r, "expected": f"{lo}-{hi}", "delta": delta,
            })

    surprises.sort(key=lambda s: abs(s["delta"]), reverse=True)

    out = [f"## Tier-hint drift ({len(surprises)} surprises)\n"]
    out.append("Repos where V4 score significantly disagreed with our pre-audit tier guess.\n")
    out.append("| Repo | V4 Score | Expected | Δ | Judge |")
    out.append("|---|---|---|---|---|")
    for s in surprises[:25]:
        repo = s["repo_url"].replace("https://github.com/", "")
        jc = f"{s['judge_confidence']:.2f}" if s["judge_confidence"] is not None else "?"
        out.append(f"| {repo} | {s['repo_score']} | {s['expected']} | {s['delta']:+d} | {jc} |")
    return "\n".join(out)


def _section_flagged() -> str:
    rows = _fetchall("""
        SELECT repo_url, repo_score, repo_tier, judge_confidence, judge_notes
        FROM corpus_silver_tier
        WHERE flagged_for_review = TRUE AND succeeded = TRUE
        ORDER BY judge_confidence ASC NULLS LAST LIMIT 20
    """)
    out = [f"## Top flagged for review ({len(rows)})\n"]
    out.append("Audits the judge LLM flagged for human review (confidence < 0.6 or disagrees with tier).\n")
    out.append("| Repo | Score | Tier | Judge | Top concern |")
    out.append("|---|---|---|---|---|")
    for r in rows:
        repo = r["repo_url"].replace("https://github.com/", "")
        notes = r["judge_notes"] or ""
        try:
            parsed = json.loads(notes) if isinstance(notes, str) else notes
            concerns = parsed.get("concerns", []) if isinstance(parsed, dict) else []
            concern = (concerns[0] if concerns else "")[:80]
        except Exception:
            concern = ""
        jc = f"{r['judge_confidence']:.2f}" if r["judge_confidence"] is not None else "?"
        out.append(f"| {repo} | {r['repo_score']} | {r['repo_tier']} | {jc} | {concern} |")
    return "\n".join(out)


def _section_failures() -> str:
    rows = _fetchall("""
        SELECT repo_url, discovery_source, errors
        FROM corpus_silver_tier
        WHERE succeeded = FALSE
        ORDER BY audited_at DESC
    """)
    if not rows:
        return "## Failures\n\nNo failures.\n"
    out = [f"## Failures ({len(rows)})\n", "| Repo | Source | Error |", "|---|---|---|"]
    for r in rows:
        repo = r["repo_url"].replace("https://github.com/", "")
        errs = r["errors"] or []
        first = (errs[0] if errs else "?")[:100]
        out.append(f"| {repo} | {r['discovery_source']} | {first} |")
    return "\n".join(out)


def _section_top_surprises() -> str:
    """The most interesting score-vs-expected disagreements."""
    rows = _fetchall("""
        SELECT repo_url, repo_score, repo_tier, discovery_tier,
               features_score, architecture_score, intent_score,
               forensics_score, ownership_score, judge_confidence, tier3_count
        FROM corpus_silver_tier
        WHERE succeeded = TRUE AND repo_score IS NOT NULL
    """)
    tier_ranges = {
        "wrapper": (0, 50), "edge-case": (0, 35),
        "mid-glue": (40, 75), "senior-infra": (60, 90), "deep-tech": (80, 100),
    }
    annotated = []
    for r in rows:
        rng = tier_ranges.get(r["discovery_tier"])
        if not rng:
            continue
        lo, hi = rng
        delta = 0
        if r["repo_score"] > hi:
            delta = r["repo_score"] - hi
        elif r["repo_score"] < lo:
            delta = r["repo_score"] - lo
        if abs(delta) >= 8:
            annotated.append({**r, "expected_range": f"{lo}-{hi}", "delta": delta})
    annotated.sort(key=lambda r: abs(r["delta"]), reverse=True)

    out = [f"## Top score surprises ({len(annotated)} significant)\n"]
    out.append("Repos where V4 disagreed with our pre-audit tier guess by 8+ points.\n")
    out.append("Could be: hand-label wrong, V4 wrong, or genuine interesting case.\n")
    out.append("| Repo | V4 Score | Tier Hint | Expected | Δ | F/A/I/Fo/Own | T3 | Judge |")
    out.append("|---|---|---|---|---|---|---|---|")
    for r in annotated[:15]:
        repo = r["repo_url"].replace("https://github.com/", "")
        buckets = f"{r['features_score']}/{r['architecture_score']}/{r['intent_score']}/{r['forensics_score']}/{r['ownership_score']}"
        jc = f"{r['judge_confidence']:.2f}" if r["judge_confidence"] is not None else "?"
        out.append(
            f"| {repo} | {r['repo_score']} | {r['discovery_tier']} | "
            f"{r['expected_range']} | {r['delta']:+d} | {buckets} | "
            f"{r['tier3_count']} | {jc} |"
        )
    return "\n".join(out)


def _section_language_coverage() -> str:
    rows = _fetchall("""
        SELECT discovery_language, COUNT(*) AS n,
               SUM(CASE WHEN succeeded THEN 1 ELSE 0 END) AS ok,
               ROUND(AVG(CASE WHEN succeeded THEN repo_score END)::numeric, 1) AS avg_score
        FROM corpus_silver_tier
        GROUP BY discovery_language ORDER BY n DESC
    """)
    out = ["## Language coverage\n\n| Language | Count | Succeeded | Avg Score |", "|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r['discovery_language']} | {r['n']} | {r['ok']} | {r['avg_score']} |")
    return "\n".join(out)


def _section_judge_distribution() -> str:
    rows = _fetchall("""
        SELECT
            CASE
              WHEN judge_confidence >= 0.9 THEN '0.9-1.0 high'
              WHEN judge_confidence >= 0.7 THEN '0.7-0.9 good'
              WHEN judge_confidence >= 0.5 THEN '0.5-0.7 medium'
              WHEN judge_confidence >= 0.3 THEN '0.3-0.5 low'
              WHEN judge_confidence >= 0.0 THEN '0.0-0.3 very low'
              ELSE 'no judge'
            END AS bucket,
            COUNT(*) AS n
        FROM corpus_silver_tier
        WHERE succeeded = TRUE
        GROUP BY bucket ORDER BY bucket DESC
    """)
    out = ["## Judge LLM confidence distribution\n\n| Bucket | Count |", "|---|---|"]
    for r in rows:
        out.append(f"| {r['bucket']} | {r['n']} |")
    return "\n".join(out)


def _section_tier3_distribution() -> str:
    rows = _fetchall("""
        SELECT tier3_count, COUNT(*) AS n,
               ROUND(AVG(repo_score)::numeric, 1) AS avg_score
        FROM corpus_silver_tier
        WHERE succeeded = TRUE
        GROUP BY tier3_count ORDER BY tier3_count
    """)
    out = ["## Non-UI TIER_3_DEEP claim distribution\n",
           "How many 'deep' claims V4 found per repo. Validates the graduated T3 gatekeeper.\n",
           "| T3 claims | Count | Avg Score |", "|---|---|---|"]
    for r in rows:
        out.append(f"| {r['tier3_count']} | {r['n']} | {r['avg_score']} |")
    return "\n".join(out)


def _section_full_table() -> str:
    rows = _fetchall("""
        SELECT repo_url, discovery_source, discovery_language, discovery_tier,
               repo_score, repo_tier, features_score, architecture_score,
               intent_score, forensics_score, ownership_score, claim_count,
               tier3_count, judge_confidence, flagged_for_review,
               total_ms, succeeded
        FROM corpus_silver_tier ORDER BY repo_score DESC NULLS LAST
    """)
    out = [f"## Full audit table ({len(rows)})\n"]
    out.append("| Repo | Score | Tier | F | A | I | Fo | Own | Claims | T3 | Judge | Flag | Time | Source |")
    out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        repo = r["repo_url"].replace("https://github.com/", "")
        score = r["repo_score"] if r["repo_score"] is not None else "—"
        tier = (r["repo_tier"] or "—").replace("TIER_", "T")
        jc = f"{r['judge_confidence']:.2f}" if r["judge_confidence"] is not None else "—"
        flag = "🚩" if r["flagged_for_review"] else ""
        time_s = f"{r['total_ms']//1000}s" if r["total_ms"] else "—"
        ok = "✓" if r["succeeded"] else "✗"
        out.append(
            f"| {repo} | {score} {ok} | {tier} | "
            f"{r['features_score'] or '—'} | {r['architecture_score'] or '—'} | "
            f"{r['intent_score'] or '—'} | {r['forensics_score'] or '—'} | "
            f"{r['ownership_score'] or '—'} | {r['claim_count'] or 0} | "
            f"{r['tier3_count'] or 0} | {jc} | {flag} | {time_s} | "
            f"{r['discovery_source']} |"
        )
    return "\n".join(out)


def generate_report(output_path: Path) -> str:
    """Generate the corpus report markdown file. Returns the path."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    sections = [
        f"# DevProof Corpus Report\n",
        f"Generated: {now}\n",
        f"DB: Supabase Postgres `cnpzrvjrwqwjsduwljyx`, table `corpus_silver_tier`\n",
        "---\n",
        _section_overall(),
        "---\n",
        _section_top_surprises(),
        "---\n",
        _section_by_tier(),
        "---\n",
        _section_by_source(),
        "---\n",
        _section_language_coverage(),
        "---\n",
        _section_judge_distribution(),
        "---\n",
        _section_tier3_distribution(),
        "---\n",
        _section_tier_hint_drift(),
        "---\n",
        _section_flagged(),
        "---\n",
        _section_failures(),
        "---\n",
        _section_full_table(),
    ]

    content = "\n".join(sections)
    output_path.write_text(content, encoding="utf-8")
    return str(output_path)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        default="D:/Projects/github-contributions-search/ai-engine/diagnostic/corpus_morning_report.md",
    )
    args = parser.parse_args()
    out = generate_report(Path(args.out))
    print(f"Report written to: {out}")
