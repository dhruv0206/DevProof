"""Curated 100-repo seed list for the corpus grower's first batch.

40/30/30 mix:
- 40 USER_RELEVANT: top OSS by language that real candidates' work touches
- 30 STRATIFIED: balanced across tiers (wrapper/mid-glue/senior-infra/deep-tech)
- 30 ADVERSARIAL: stress tests (AI-scaffolds, churn, single-commit, bots,
  hackathon outputs) - the cases where V4 should NOT be fooled

Each entry: (url, discovery_source, discovery_language, discovery_tier_hint)
The "tier_hint" is our pre-audit guess; the algo confirms or disagrees.
"""
from __future__ import annotations

USER_RELEVANT = [
    # Python — most-touched libs in candidate portfolios
    ("https://github.com/pallets/jinja", "top-pypi", "python", "senior-infra"),
    ("https://github.com/sqlalchemy/sqlalchemy", "top-pypi", "python", "deep-tech"),
    ("https://github.com/django/django", "top-pypi", "python", "deep-tech"),
    ("https://github.com/encode/starlette", "top-pypi", "python", "senior-infra"),
    ("https://github.com/celery/celery", "top-pypi", "python", "deep-tech"),
    ("https://github.com/aio-libs/aiohttp", "top-pypi", "python", "senior-infra"),
    ("https://github.com/pytest-dev/pytest", "top-pypi", "python", "senior-infra"),
    ("https://github.com/python-pillow/Pillow", "top-pypi", "python", "deep-tech"),
    ("https://github.com/scikit-learn/scikit-learn", "top-pypi", "python", "deep-tech"),
    ("https://github.com/pyca/cryptography", "top-pypi", "python", "deep-tech"),
    # JavaScript/TypeScript
    ("https://github.com/expressjs/express", "top-npm", "javascript", "senior-infra"),
    ("https://github.com/vuejs/core", "top-npm", "typescript", "deep-tech"),
    ("https://github.com/sveltejs/svelte", "top-npm", "typescript", "deep-tech"),
    ("https://github.com/vercel/next.js", "top-npm", "typescript", "deep-tech"),
    ("https://github.com/remix-run/react-router", "top-npm", "typescript", "senior-infra"),
    ("https://github.com/axios/axios", "top-npm", "javascript", "senior-infra"),
    ("https://github.com/lodash/lodash", "top-npm", "javascript", "senior-infra"),
    ("https://github.com/prisma/prisma", "top-npm", "typescript", "deep-tech"),
    ("https://github.com/trpc/trpc", "top-npm", "typescript", "senior-infra"),
    ("https://github.com/honojs/hono", "top-npm", "typescript", "senior-infra"),
    # Rust
    ("https://github.com/tokio-rs/tokio", "top-crates", "rust", "deep-tech"),
    ("https://github.com/serde-rs/serde", "top-crates", "rust", "deep-tech"),
    ("https://github.com/rust-lang/cargo", "top-crates", "rust", "deep-tech"),
    ("https://github.com/clap-rs/clap", "top-crates", "rust", "senior-infra"),
    ("https://github.com/seanmonstar/reqwest", "top-crates", "rust", "senior-infra"),
    # Go
    ("https://github.com/gin-gonic/gin", "top-go", "go", "senior-infra"),
    ("https://github.com/spf13/cobra", "top-go", "go", "senior-infra"),
    ("https://github.com/labstack/echo", "top-go", "go", "senior-infra"),
    ("https://github.com/grpc/grpc-go", "top-go", "go", "deep-tech"),
    ("https://github.com/prometheus/prometheus", "top-go", "go", "deep-tech"),
    # Misc langs
    ("https://github.com/spring-projects/spring-boot", "top-java", "java", "deep-tech"),
    ("https://github.com/JetBrains/kotlin", "top-jvm", "kotlin", "deep-tech"),
    ("https://github.com/microsoft/TypeScript", "top-lang", "typescript", "deep-tech"),
    ("https://github.com/python/cpython", "top-lang", "python", "deep-tech"),
    ("https://github.com/golang/go", "top-lang", "go", "deep-tech"),
    # Tools / DevOps
    ("https://github.com/docker/docker-py", "top-pypi", "python", "senior-infra"),
    ("https://github.com/redis/redis-py", "top-pypi", "python", "senior-infra"),
    ("https://github.com/kubernetes-client/python", "top-pypi", "python", "senior-infra"),
    ("https://github.com/getsentry/responses", "top-pypi", "python", "mid-glue"),
    ("https://github.com/psf/requests", "top-pypi", "python", "senior-infra"),
]

STRATIFIED = [
    # Wrapper-tier (small utilities, intentional)
    ("https://github.com/jpadilla/pyjwt", "stratified", "python", "wrapper"),
    ("https://github.com/sindresorhus/strip-ansi", "stratified", "javascript", "wrapper"),
    ("https://github.com/sindresorhus/chalk", "stratified", "javascript", "wrapper"),
    ("https://github.com/sindresorhus/got", "stratified", "javascript", "wrapper"),
    ("https://github.com/expressjs/cookie-parser", "stratified", "javascript", "wrapper"),
    ("https://github.com/jonschlinkert/is-number", "stratified", "javascript", "wrapper"),
    # Mid-glue (SDK orchestration / framework wrappers)
    ("https://github.com/encode/databases", "stratified", "python", "mid-glue"),
    ("https://github.com/encode/uvicorn", "stratified", "python", "mid-glue"),
    ("https://github.com/cleardusk/3DDFA", "stratified", "python", "mid-glue"),
    ("https://github.com/redis/node-redis", "stratified", "javascript", "mid-glue"),
    ("https://github.com/mongodb/node-mongodb-native", "stratified", "javascript", "mid-glue"),
    ("https://github.com/nestjs/nest", "stratified", "typescript", "mid-glue"),
    ("https://github.com/strapi/strapi", "stratified", "javascript", "mid-glue"),
    ("https://github.com/getmoto/moto", "stratified", "python", "mid-glue"),
    # Senior-infra (production-grade systems)
    ("https://github.com/streamlit/streamlit", "stratified", "python", "senior-infra"),
    ("https://github.com/gradio-app/gradio", "stratified", "python", "senior-infra"),
    ("https://github.com/dagster-io/dagster", "stratified", "python", "senior-infra"),
    ("https://github.com/apache/airflow", "stratified", "python", "senior-infra"),
    ("https://github.com/pola-rs/polars", "stratified", "rust", "deep-tech"),
    ("https://github.com/duckdb/duckdb", "stratified", "cpp", "deep-tech"),
    ("https://github.com/openobserve/openobserve", "stratified", "rust", "senior-infra"),
    ("https://github.com/PostgREST/postgrest", "stratified", "haskell", "deep-tech"),
    # Deep-tech (real engineering / research)
    ("https://github.com/huggingface/transformers", "stratified", "python", "deep-tech"),
    ("https://github.com/pytorch/pytorch", "stratified", "python", "deep-tech"),
    ("https://github.com/openai/whisper", "stratified", "python", "deep-tech"),
    ("https://github.com/microsoft/playwright", "stratified", "typescript", "deep-tech"),
    ("https://github.com/grafana/grafana", "stratified", "typescript", "deep-tech"),
    ("https://github.com/elastic/elasticsearch", "stratified", "java", "deep-tech"),
    ("https://github.com/temporalio/temporal", "stratified", "go", "deep-tech"),
    ("https://github.com/etcd-io/etcd", "stratified", "go", "deep-tech"),
]

ADVERSARIAL = [
    # Hackathon-style burst projects (real, recent, AI-suspected)
    ("https://github.com/openai/openai-cookbook", "adversarial-burst", "jupyter", "mid-glue"),
    ("https://github.com/All-Hands-AI/OpenHands", "adversarial-ai-tool", "python", "senior-infra"),
    ("https://github.com/microsoft/autogen", "adversarial-ai-tool", "python", "senior-infra"),
    ("https://github.com/langchain-ai/langchain", "adversarial-ai-tool", "python", "senior-infra"),
    ("https://github.com/run-llama/llama_index", "adversarial-ai-tool", "python", "senior-infra"),
    ("https://github.com/Significant-Gravitas/AutoGPT", "adversarial-ai-tool", "python", "mid-glue"),
    ("https://github.com/lobehub/lobe-chat", "adversarial-ai-tool", "typescript", "mid-glue"),
    ("https://github.com/danny-avila/LibreChat", "adversarial-ai-tool", "typescript", "mid-glue"),
    ("https://github.com/mckaywrigley/chatbot-ui", "adversarial-ai-tool", "typescript", "wrapper"),
    ("https://github.com/iann838/cloudpouch", "adversarial-burst", "typescript", "wrapper"),
    # Known boilerplate / awesome-lists / non-code repos
    ("https://github.com/donnemartin/system-design-primer", "adversarial-non-code", "python", "edge-case"),
    ("https://github.com/EbookFoundation/free-programming-books", "adversarial-non-code", "html", "edge-case"),
    ("https://github.com/getify/You-Dont-Know-JS", "adversarial-non-code", "javascript", "edge-case"),
    ("https://github.com/jwasham/coding-interview-university", "adversarial-non-code", "markdown", "edge-case"),
    # Bot-heavy / dependency-bumper repos
    ("https://github.com/dependabot/dependabot-core", "adversarial-bot", "ruby", "senior-infra"),
    ("https://github.com/renovatebot/renovate", "adversarial-bot", "typescript", "senior-infra"),
    # Single-author dominant small libs (test small-lib cap)
    ("https://github.com/kennethreitz/legit", "adversarial-single-author", "python", "wrapper"),
    ("https://github.com/Textualize/textual", "adversarial-single-author", "python", "senior-infra"),
    ("https://github.com/willmcgugan/rich-cli", "adversarial-single-author", "python", "mid-glue"),
    ("https://github.com/jorgebucaran/fisher", "adversarial-single-author", "shell", "wrapper"),
    # Heavy AI-assisted / agent-merge patterns
    ("https://github.com/cline/cline", "adversarial-ai-tool", "typescript", "senior-infra"),
    ("https://github.com/sourcegraph/cody", "adversarial-ai-tool", "typescript", "senior-infra"),
    ("https://github.com/continuedev/continue", "adversarial-ai-tool", "typescript", "senior-infra"),
    # Tutorial / template repos
    ("https://github.com/tiangolo/full-stack-fastapi-template", "adversarial-template", "python", "mid-glue"),
    ("https://github.com/vercel/next.js/tree/canary/examples", "adversarial-template", "typescript", "edge-case"),
    ("https://github.com/shadcn-ui/ui", "adversarial-cli", "typescript", "senior-infra"),
    # Recent OSS launches (likely contains AI-augmented code)
    ("https://github.com/highlight/highlight", "adversarial-recent", "typescript", "senior-infra"),
    ("https://github.com/PostHog/posthog", "adversarial-recent", "python", "deep-tech"),
    ("https://github.com/cal-com/cal.com", "adversarial-recent", "typescript", "deep-tech"),
    ("https://github.com/twentyhq/twenty", "adversarial-recent", "typescript", "senior-infra"),
]

ALL_REPOS = USER_RELEVANT + STRATIFIED + ADVERSARIAL

assert len(ALL_REPOS) == 100, f"Seed list must have 100 repos, has {len(ALL_REPOS)}"


def get_seed_list() -> list[tuple[str, str, str, str]]:
    """Return the full 100-repo seed list."""
    return ALL_REPOS
