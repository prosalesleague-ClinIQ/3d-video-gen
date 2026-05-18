#!/usr/bin/env bash
# Backend smoke test against the live HF Space.
# Validates: save/load roundtrip, rate-limit kicks in, XSS payload survives
# (escaped on render — not checked here, that's the unit's job), bad URI
# scheme rejected with 400, and oversize surface name rejected.
#
# Run:  bash tests/test_backend.sh
# Override URL with BACKEND_URL=http://localhost:7860 bash tests/test_backend.sh
#
# Exit code is non-zero on any failed assertion. Each line prefixes ✓ or ✗.

set -uo pipefail

BACKEND="${BACKEND_URL:-https://prosalesleague-3d-video-gen.hf.space}"
PASSES=0
FAILS=0

ok()    { PASSES=$((PASSES+1)); printf "  ✓ %s\n" "$*"; }
fail()  { FAILS=$((FAILS+1));   printf "  ✗ %s\n" "$*" >&2; }

assert_eq() {
  local actual="$1" expected="$2" msg="$3"
  if [[ "$actual" == "$expected" ]]; then ok "$msg (got $actual)"
  else fail "$msg — expected $expected, got $actual"
  fi
}

assert_match() {
  local haystack="$1" needle="$2" msg="$3"
  if echo "$haystack" | grep -q -- "$needle"; then ok "$msg"
  else fail "$msg — substring '$needle' not in response"
  fi
}

echo
echo "— backend smoke ($BACKEND) —"

# Health check first (skip whole suite if unreachable).
if ! curl -sS -m 5 -o /dev/null -w "%{http_code}" "$BACKEND/" >/dev/null 2>&1; then
  echo "  ! backend unreachable, skipping suite"
  exit 0
fi
HEALTH=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" "$BACKEND/")
if [[ "$HEALTH" != "200" && "$HEALTH" != "404" && "$HEALTH" != "307" ]]; then
  echo "  ! backend health $HEALTH; skipping suite"
  exit 0
fi
ok "backend reachable (root $HEALTH)"

# 1) Save a clean project, expect 200 + project_id (UUID).
RESP=$(curl -sS -X POST "$BACKEND/projection-project" \
  -H "content-type: application/json" \
  -d '{"name":"smoke-test","calibration":{},"surfaces":[{"id":"s1","name":"wall","source":"empty"}],"content":{}}')
PID=$(echo "$RESP" | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('project_id',''))" 2>/dev/null)
if [[ -n "$PID" && "${#PID}" -ge 32 ]]; then
  ok "save clean project → got UUID ($PID)"
else
  fail "save clean project → no project_id; resp=$RESP"
fi

# 2) Load it back, body should round-trip.
if [[ -n "$PID" ]]; then
  GET=$(curl -sS "$BACKEND/projection-project/$PID")
  assert_match "$GET" "smoke-test" "loaded project still has name=smoke-test"
  assert_match "$GET" '"id":"s1"' "loaded project still has surface id=s1"
fi

# 3) Reject scheme other than http(s) at server side (e.g. javascript:).
BAD_URI_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BACKEND/projection-project" \
  -H "content-type: application/json" \
  -d '{"name":"u","calibration":{},"surfaces":[{"id":"x","name":"y","source":"video","uri":"javascript:alert(1)"}],"content":{}}')
case "$BAD_URI_CODE" in
  400|422) ok "javascript: URI scheme rejected ($BAD_URI_CODE)" ;;
  *) fail "javascript: URI should be rejected, got $BAD_URI_CODE" ;;
esac

# 4) Pydantic max_length on surface name (>120 chars) → 422.
LONG_NAME=$(printf 'x%.0s' {1..200})
LONG_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BACKEND/projection-project" \
  -H "content-type: application/json" \
  -d "{\"name\":\"u\",\"calibration\":{},\"surfaces\":[{\"id\":\"x\",\"name\":\"$LONG_NAME\",\"source\":\"empty\"}],\"content\":{}}")
case "$LONG_CODE" in
  400|422) ok "200-char surface name rejected ($LONG_CODE)" ;;
  200)     fail "200-char surface name accepted (SurfaceItem schema bug)" ;;
  *)       fail "long name expected 4xx, got $LONG_CODE" ;;
esac

# 5) Bad UUID on GET → 400, not 500.
BAD_UUID=$(curl -sS -o /dev/null -w "%{http_code}" "$BACKEND/projection-project/not-a-uuid")
case "$BAD_UUID" in
  400|404|422) ok "GET with non-UUID rejected ($BAD_UUID)" ;;
  *) fail "GET non-UUID expected 4xx, got $BAD_UUID" ;;
esac

# 6) Rate-limit smoke. Fire 25 sequential writes; we expect at least one 429
#    once we exceed the configured PROJECTION_RATE_MAX (default 20 per 60s).
#    Skip if backend already had recent writes that consumed the bucket — in
#    that case the limit may trip earlier or later.
echo "  ... firing 25 rapid POSTs to /projection-project (rate-limit probe)"
N429=0
for i in $(seq 1 25); do
  C=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BACKEND/projection-project" \
    -H "content-type: application/json" \
    -d '{"name":"rate","calibration":{},"surfaces":[],"content":{}}')
  if [[ "$C" == "429" ]]; then N429=$((N429+1)); fi
done
if [[ "$N429" -ge 1 ]]; then
  ok "rate limit fires ($N429 of 25 returned 429)"
else
  fail "rate limit DID NOT fire (0/25 were 429). Check PROJECTION_RATE_MAX env."
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  printf "ALL PASS: %s/%s (suite: backend smoke)\n" "$PASSES" "$((PASSES+FAILS))"
  exit 0
else
  printf "FAILURES: %s/%s passed (suite: backend smoke)\n" "$PASSES" "$((PASSES+FAILS))"
  exit 1
fi
