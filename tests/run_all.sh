#!/usr/bin/env bash
# Single entry point. Run every test in a stable order; total runtime ~5–10s
# (the backend smoke spends most of that on the 25-burst rate-limit probe).
#
#   bash tests/run_all.sh             # default backend
#   BACKEND_URL=http://localhost:7860 bash tests/run_all.sh
#   bash tests/run_all.sh --quick     # skip the live-backend tests
#
# Exit code is the sum of failures across all suites.

set -u
QUICK=0
for arg in "$@"; do [[ "$arg" == "--quick" ]] && QUICK=1; done

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILS=0
SUITES=0

run() {
  SUITES=$((SUITES+1))
  echo
  echo "════════════════════════════════════════════════════════"
  echo " ▶ $*"
  echo "════════════════════════════════════════════════════════"
  "$@"
  local code=$?
  if [[ $code -ne 0 ]]; then FAILS=$((FAILS+1)); fi
}

# 0. Syntax pass on every JS file that ships to the browser.
echo "Syntax-checking shipped JS…"
JS_FILES=(
  public/onee_filter.js
  public/hand_filters.js
  public/gaze_tracking.js
  public/webcam.js
  public/head_tracking.js
  public/hand_tracking.js
  public/projection_mapping.js
  public/mapper.js
  public/player.js
  public/app.js
  public/dashboard_3d.js
  public/player_stereo.js
  public/player_styles.js
  public/video_library.js
  public/quality.js
  public/lib/perspt.js
  public/lib/maptastic.js
)
SYNTAX_FAIL=0
for f in "${JS_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    if node --check "$f" >/dev/null 2>&1; then
      printf "  ✓ %s\n" "$f"
    else
      printf "  ✗ %s\n" "$f"
      node --check "$f"
      SYNTAX_FAIL=$((SYNTAX_FAIL+1))
    fi
  fi
done
if [[ "$SYNTAX_FAIL" -ne 0 ]]; then
  echo "  ! $SYNTAX_FAIL file(s) failed syntax check"
  FAILS=$((FAILS+1))
fi
SUITES=$((SUITES+1))

# 1. Python syntax for the backend.
if command -v python3 >/dev/null 2>&1; then
  echo "Syntax-checking demo-service/app.py…"
  if python3 -c "import ast; ast.parse(open('demo-service/app.py').read())" 2>/dev/null; then
    echo "  ✓ demo-service/app.py"
  else
    echo "  ✗ demo-service/app.py"
    python3 -c "import ast; ast.parse(open('demo-service/app.py').read())"
    FAILS=$((FAILS+1))
  fi
  SUITES=$((SUITES+1))
fi

# 2. Pure-JS unit + integration tests.
run node tests/test_perspt.mjs
run node tests/test_hand_filters.mjs
run node tests/test_gaze_tracking.mjs
run node tests/test_imports.mjs
run node tests/test_html_smoke.mjs

# 3. Live-backend tests — skipped in --quick mode.
if [[ "$QUICK" -eq 0 ]]; then
  run node tests/test_e2e_scan_map_project.mjs
  run bash tests/test_backend.sh
else
  echo
  echo "(skipping live-backend tests in --quick mode)"
fi

# Summary.
echo
echo "════════════════════════════════════════════════════════"
if [[ "$FAILS" -eq 0 ]]; then
  echo " ALL SUITES PASS ($SUITES/$SUITES)"
  exit 0
else
  echo " FAILURES: $FAILS of $SUITES suites failed"
  echo
  echo " If the failures are in the backend-smoke suite (URI guard,"
  echo " surface-name length, rate limit), the cause is almost certainly"
  echo " that demo-service/app.py was patched locally (commit aa50788)"
  echo " but the HF Space backend hasn't been redeployed yet."
  echo
  echo "   cd demo-service && git push hf main"
  echo
  echo " The CLIENT-side defenses (XSS escape in mapper.js / player.js /"
  echo " app.js, URI scheme guard in projection_mapping.js) are LIVE"
  echo " once you 'vercel --prod' — the backend is the second layer."
  echo "════════════════════════════════════════════════════════"
  exit 1
fi
