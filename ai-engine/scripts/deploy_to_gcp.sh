#!/usr/bin/env bash
# DevProof — one-shot Cloud Run setup for a fresh GCP project.
#
# Reads secrets from ai-engine/.env (gitignored) so nothing sensitive lives
# in this script. Idempotent: safe to re-run; existing resources are reused
# rather than recreated.
#
# Usage:
#   1. Edit the CONFIG section below (PROJECT_ID, REGION, etc.)
#   2. Make sure ai-engine/.env has all required keys (script will check)
#   3. From repo root:  bash ai-engine/scripts/deploy_to_gcp.sh
#
# Requires: gcloud CLI installed + authenticated (`gcloud auth login`).

set -euo pipefail

# ─── CONFIG ──────────────────────────────────────────────────────────────────
# REQUIRED — set this to your GCP project ID:
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID env var or edit this script. e.g. PROJECT_ID=devproof-2026 bash deploy_to_gcp.sh}"

# Defaulted — only override if needed:
REGION="${REGION:-us-east1}"                       # match Supabase (aws-1-us-east-1)
SERVICE_NAME="${SERVICE_NAME:-ai-engine}"

# Cloud Run sizing — bump memory if you see OOMs on big repos.
MEMORY="${MEMORY:-2Gi}"
CPU="${CPU:-2}"
TIMEOUT="${TIMEOUT:-3600}"       # 1h max (Cloud Run hard cap)
CONCURRENCY="${CONCURRENCY:-10}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"

# Variance: read directly from .env. If V4_DEFAULT_VARIANCE_SAMPLES is in
# your .env, that value goes to Cloud Run. If not, defaults to 1 (free tier).
# To change later without redeploying:
#   gcloud run services update ai-engine --region=us-east1 \
#     --update-env-vars V4_DEFAULT_VARIANCE_SAMPLES=3

# ─── Helpers ────────────────────────────────────────────────────────────────
log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ⚠\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m  ✗\033[0m %s\n' "$*" >&2; exit 1; }

# Resolve repo root from this script's location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/ai-engine/.env"

# ─── Pre-flight checks ──────────────────────────────────────────────────────
log "Pre-flight checks"

command -v gcloud >/dev/null 2>&1 || err "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
ok "gcloud is installed"

ACCOUNT=$(gcloud config get-value account 2>/dev/null || echo "")
[ -z "$ACCOUNT" ] && err "gcloud not authenticated. Run: gcloud auth login"
ok "authenticated as: $ACCOUNT"

[ ! -f "$ENV_FILE" ] && err ".env file not found at $ENV_FILE — populate it before running."
ok "found .env at $ENV_FILE"

# Source .env using bash's native loader so quoted values (URLs with
# special chars, multi-line PEM keys) parse correctly.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Verify required secrets are present in the env file.
REQUIRED_KEYS=(GEMINI_API_KEY PINECONE_API_KEY GITHUB_TOKEN DATABASE_URL INTERNAL_PROXY_SECRET)
for key in "${REQUIRED_KEYS[@]}"; do
  if [ -z "${!key:-}" ]; then
    err "Required key '$key' missing from $ENV_FILE"
  fi
done
ok "all required keys present in .env"

# Optional keys — log warnings but don't fail.
OPTIONAL_KEYS=(LOGFIRE_TOKEN PINECONE_INDEX_NAME GH_APP_ID GH_PRIVATE_KEY)
for key in "${OPTIONAL_KEYS[@]}"; do
  [ -z "${!key:-}" ] && warn "optional key '$key' missing — will be skipped"
done

# ─── 1. Project + APIs ──────────────────────────────────────────────────────
log "Step 1/7: switching to project '$PROJECT_ID' and enabling APIs"

gcloud config set project "$PROJECT_ID" >/dev/null
ok "active project: $PROJECT_ID"

gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com 2>&1 | sed 's/^/  /'
ok "APIs enabled"

# ─── 2. Region ──────────────────────────────────────────────────────────────
log "Step 2/7: setting Cloud Run region to '$REGION'"
gcloud config set run/region "$REGION" >/dev/null
ok "region set: $REGION"

# ─── 3. Create / update secrets in Secret Manager ───────────────────────────
log "Step 3/7: syncing secrets to Secret Manager"

# Map of GCP-secret-name → env-var-name in .env
declare -A SECRETS=(
  [gemini-api-key]=GEMINI_API_KEY
  [pinecone-api-key]=PINECONE_API_KEY
  [github-token]=GITHUB_TOKEN
  [database-url]=DATABASE_URL
  # Shared secret between Next.js proxies and FastAPI. Required so
  # FastAPI rejects anonymous curls that attempt to impersonate a user
  # by setting X-User-Id directly. Generate via:
  #   openssl rand -base64 32
  # and add to ai-engine/.env AND the Vercel project env.
  [internal-proxy-secret]=INTERNAL_PROXY_SECRET
)
# Logfire is optional — add only if present.
if [ -n "${LOGFIRE_TOKEN:-}" ]; then
  SECRETS[logfire-token]=LOGFIRE_TOKEN
fi

for secret_name in "${!SECRETS[@]}"; do
  env_var="${SECRETS[$secret_name]}"
  value="${!env_var}"
  if gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    # Existing secret — add a new version (idempotent for re-runs).
    echo -n "$value" | gcloud secrets versions add "$secret_name" --data-file=- >/dev/null
    ok "secret '$secret_name' updated (new version added)"
  else
    echo -n "$value" | gcloud secrets create "$secret_name" --data-file=- --replication-policy=automatic >/dev/null
    ok "secret '$secret_name' created"
  fi
done

# ─── 4. Grant service account access to secrets ────────────────────────────
log "Step 4/7: granting IAM access to Cloud Run + Cloud Build service accounts"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
ok "runtime SA: $RUNTIME_SA"
ok "build SA:   $BUILD_SA"

for secret_name in "${!SECRETS[@]}"; do
  # Runtime access (Cloud Run reads secrets at request time).
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null 2>&1 || true
done

# Build-time access — only github-token needs to be readable at build,
# for cloning the private algo repo during pip install.
gcloud secrets add-iam-policy-binding "github-token" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null 2>&1 || true

ok "IAM bindings applied (runtime: ${#SECRETS[@]} secrets, build: 1 secret)"

# ─── 5. Build the container image ───────────────────────────────────────────
log "Step 5/7: building container image via Cloud Build"
log "  (this takes 3-6 minutes for the first build)"
log "  GITHUB_TOKEN sourced from Secret Manager (not passed as substitution)"

IMAGE="gcr.io/${PROJECT_ID}/backend"
gcloud builds submit \
  --config="${REPO_ROOT}/ai-engine/ai-engine-cloudbuild.yaml" \
  "$REPO_ROOT" 2>&1 | sed 's/^/  /' | tail -20
ok "image built and pushed: $IMAGE"

# ─── 6. Deploy to Cloud Run ─────────────────────────────────────────────────
log "Step 6/7: deploying to Cloud Run"

# Build the --set-secrets argument from the SECRETS map.
# Format: ENV_VAR_NAME=secret-name:latest,...
SECRETS_ARG=""
for secret_name in "${!SECRETS[@]}"; do
  env_var="${SECRETS[$secret_name]}"
  SECRETS_ARG="${SECRETS_ARG}${env_var}=${secret_name}:latest,"
done
SECRETS_ARG="${SECRETS_ARG%,}"  # strip trailing comma

# Non-sensitive env vars go via --set-env-vars.
# Reads V4_DEFAULT_VARIANCE_SAMPLES from .env (set there), defaults to 1.
ENV_VARS="V4_DEFAULT_VARIANCE_SAMPLES=${V4_DEFAULT_VARIANCE_SAMPLES:-1}"
ENV_VARS="${ENV_VARS},PINECONE_INDEX_NAME=${PINECONE_INDEX_NAME:-github-opensource-search}"

gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --memory="$MEMORY" \
  --cpu="$CPU" \
  --timeout="$TIMEOUT" \
  --concurrency="$CONCURRENCY" \
  --min-instances="$MIN_INSTANCES" \
  --max-instances="$MAX_INSTANCES" \
  --port=8000 \
  --set-env-vars="$ENV_VARS" \
  --set-secrets="$SECRETS_ARG" \
  --quiet 2>&1 | sed 's/^/  /'
ok "service deployed"

# ─── 7. Capture URL + verify ────────────────────────────────────────────────
log "Step 7/7: verifying deployment"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)')
ok "service URL: $SERVICE_URL"

# Quick health check — root path should return something even if it's a 404
# (FastAPI returns 404 for /), as long as the container started.
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL" || echo "000")
if [[ "$HTTP_CODE" =~ ^[2-4] ]]; then
  ok "health check: HTTP $HTTP_CODE (service is responding)"
else
  warn "health check returned HTTP $HTTP_CODE — service may still be starting; check 'gcloud run services logs read $SERVICE_NAME' in a moment"
fi

# ─── Done ────────────────────────────────────────────────────────────────────
cat <<EOF

═══════════════════════════════════════════════════════════════════════════
  Deployment complete
═══════════════════════════════════════════════════════════════════════════

  Project:       $PROJECT_ID
  Region:        $REGION
  Service:       $SERVICE_NAME
  URL:           $SERVICE_URL
  Variance:      V4_DEFAULT_VARIANCE_SAMPLES=${V4_DEFAULT_VARIANCE_SAMPLES:-1}

  Next steps:

  1. Update Vercel frontend env:
       NEXT_PUBLIC_API_URL=$SERVICE_URL
     Then redeploy frontend.

  2. Smoke-test the new backend:
       curl -X POST $SERVICE_URL/api/projects/scan \\
         -H 'Content-Type: application/json' \\
         -d '{"repo_url":"https://github.com/ai/nanoid","user_id":"test"}'

  3. To flip variance dampening on later (paid tier):
       gcloud run services update $SERVICE_NAME --region=$REGION \\
         --update-env-vars V4_DEFAULT_VARIANCE_SAMPLES=3

  4. To view live logs:
       gcloud run services logs tail $SERVICE_NAME --region=$REGION

═══════════════════════════════════════════════════════════════════════════
EOF
