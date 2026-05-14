# Corpus Grower

Autonomous nightly auditor that grows the DevProof calibration corpus.

## What it does

1. Pulls repos from `seed_repos.py` (curated 100 to start, can be extended).
2. Audits each via the V4 pipeline (same as production).
3. Runs a **judge LLM** second-pass that rates V4's confidence and flags suspicious audits.
4. Writes everything to Supabase Postgres table `corpus_silver_tier`.
5. Generates morning markdown report.

## Files

| File | Purpose |
|---|---|
| `seed_repos.py` | 100 curated repos: 40 user-relevant + 30 stratified + 30 adversarial |
| `db.py` | Supabase Postgres write layer |
| `judge.py` | Second-pass LLM rubric for audit confidence |
| `grower.py` | Main orchestrator (CLI) |
| `query.py` | Quick query CLI for stats/flagged/top/by-tier |
| `report.py` | Generates morning markdown report |

## Running

### Resume / continue the grow (idempotent — skips completed)

```bash
cd ai-engine
python -X utf8 -m scripts.corpus_grower.grower --concurrency 4
```

### Re-audit everything (no skip)

```bash
python -X utf8 -m scripts.corpus_grower.grower --no-skip --concurrency 4
```

### Quick queries

```bash
python -X utf8 -m scripts.corpus_grower.query stats
python -X utf8 -m scripts.corpus_grower.query top --n 20
python -X utf8 -m scripts.corpus_grower.query flagged
python -X utf8 -m scripts.corpus_grower.query by-tier
python -X utf8 -m scripts.corpus_grower.query repo django
python -X utf8 -m scripts.corpus_grower.query failures
```

### Generate report on-demand

```bash
python -X utf8 -m scripts.corpus_grower.report \
    --out diagnostic/corpus_report_$(date +%Y%m%d).md
```

## Supabase

- **Database:** Postgres on Supabase project `cnpzrvjrwqwjsduwljyx`
- **Table:** `corpus_silver_tier` (32 columns)
- **Key fields:** `repo_url`, `repo_score`, `repo_tier`, `judge_confidence`,
  `flagged_for_review`, `v4_output` (full JSON), plus all 4 bucket scores.

## Connection

Reads `DATABASE_URL` from environment. Set it in `ai-engine/.env` (gitignored)
or export it before invoking any of these scripts. Modules raise `RuntimeError`
immediately if the env var is missing — no silent fallback to embedded creds.

## Cron setup (for nightly autonomous growth)

Once the seed list runs through, add new repos and re-run nightly:

```bash
# Add to crontab or Cloud Run scheduler
0 3 * * * cd /path/to/ai-engine && python -X utf8 -m scripts.corpus_grower.grower --concurrency 3
```

## Variance dampening

V4 has LLM-induced variance (±5-15 points). For paying customers, use:

```python
from app.services.v4_shadow_runner import run_v4_with_variance
result = await run_v4_with_variance(repo_url, github_username, db_session_factory, samples=3)
# result["variance"] = {samples, raw_scores, median, p25, p75, spread, confidence}
```

For corpus growth we run single-sample (faster, cheaper). Variance can be
measured retrospectively by re-auditing same repos and comparing.

## Cost

- ~$1 per audit (Gemini Tagger + Map + Reduce)
- ~$0.05 per judge LLM call
- 100 audits ≈ $105
- Nightly 10/day = $315/mo
