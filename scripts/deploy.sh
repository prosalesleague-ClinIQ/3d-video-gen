#!/usr/bin/env bash
# Ship the project end-to-end: front-end → Vercel, backend → HF Space, then
# run the live test suite against production. One command. Idempotent.
#
# Usage:
#   bash scripts/deploy.sh                  # full deploy
#   bash scripts/deploy.sh --skip-frontend  # backend only
#   bash scripts/deploy.sh --skip-backend   # frontend only
#   bash scripts/deploy.sh --verify-only    # smoke-test without deploying
#
# Preconditions you, the human, must have done:
#   1. Rotated the Supabase service_role key (see .audit/SUPABASE_KEY_ROTATION.md)
#   2. PR #1 merged to main (or running from main directly)
#   3. `vercel` CLI installed + logged in (npm i -g vercel + vercel login)
#   4. demo-service/ has a git remote named `hf` pointing at the HF Space.
#      If missing:
#         cd demo-service
#         git remote add hf https://huggingface.co/spaces/<your-user>/3d-video-gen
#         git fetch hf

set -euo pipefail

SKIP_FRONTEND=0
SKIP_BACKEND=0
VERIFY_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-backend)  SKIP_BACKEND=1 ;;
    --verify-only)   VERIFY_ONLY=1; SKIP_FRONTEND=1; SKIP_BACKEND=1 ;;
  esac
done

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf "\n▶ %s\n" "$*"; }

# Precondition: tests must pass before we ship anything.
say "Running test suite (--quick) before deploy…"
bash tests/run_all.sh --quick

# ---- Frontend: Vercel -----------------------------------------------------
if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
  if command -v vercel >/dev/null 2>&1; then
    say "Deploying frontend to Vercel (production)…"
    vercel --prod
  else
    say "Vercel CLI not installed. Install:  npm i -g vercel  && vercel login"
    exit 1
  fi
else
  say "Skipping frontend deploy."
fi

# ---- Backend: HF Space ----------------------------------------------------
if [[ "$SKIP_BACKEND" -eq 0 ]]; then
  cd demo-service
  if git remote get-url hf >/dev/null 2>&1; then
    say "Pushing backend to HF Space (remote: hf)…"
    git push hf HEAD:main
  else
    say "No 'hf' git remote configured in demo-service/."
    say "Run:  cd demo-service && git remote add hf https://huggingface.co/spaces/<your-user>/3d-video-gen"
    exit 1
  fi
  cd "$ROOT"
else
  say "Skipping backend deploy."
fi

# ---- Verify production after deploy --------------------------------------
say "Verifying production (headers + endpoint)…"
PROD_FE="https://3d-video-gen.vercel.app"
PROD_BE="https://prosalesleague-3d-video-gen.hf.space"

# CSP header should ship from main now.
if curl -sI "$PROD_FE/" | grep -qi "content-security-policy"; then
  echo "  ✓ CSP header live on $PROD_FE"
else
  echo "  ✗ CSP header NOT live on $PROD_FE — deploy may still be propagating"
fi
if curl -sI "$PROD_FE/" | grep -qi "x-frame-options: DENY"; then
  echo "  ✓ X-Frame-Options: DENY live on $PROD_FE"
else
  echo "  ✗ X-Frame-Options NOT live on $PROD_FE"
fi
if curl -sI "$PROD_FE/" | grep -qi "permissions-policy"; then
  echo "  ✓ Permissions-Policy live on $PROD_FE"
fi

# Backend should reject javascript: URI now that demo-service was redeployed.
URI_CHECK=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$PROD_BE/projection-project" \
  -H "content-type: application/json" \
  -d '{"name":"verify","calibration":{},"surfaces":[{"id":"x","name":"y","source":"video","uri":"javascript:alert(1)"}],"content":{}}' || echo "000")
if [[ "$URI_CHECK" -ge 400 && "$URI_CHECK" -lt 500 ]]; then
  echo "  ✓ Backend rejects javascript: URI ($URI_CHECK)"
else
  echo "  ✗ Backend still accepts javascript: URI (got $URI_CHECK) — redeploy may still be propagating"
fi

# Run the live-backend smoke test for thorough verification.
if [[ "$VERIFY_ONLY" -eq 0 ]]; then
  say "Running live-backend smoke…"
fi
bash tests/run_all.sh || true

say "Done."
