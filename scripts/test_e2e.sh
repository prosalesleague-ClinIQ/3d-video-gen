#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:8000}"
DB_URL="${DB_URL:-postgresql://studio:studio@localhost:5432/studio}"
PROMPT="${1:-test cube}"
TIMEOUT=600

echo "Sending prompt: $PROMPT"
RESPONSE=$(curl -s -X POST "$API_URL/scene" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"$PROMPT\"}")

SCENE_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['scene_id'])")
echo "Scene ID: $SCENE_ID"

echo "Waiting for 240 scores (timeout: ${TIMEOUT}s)..."
START=$(date +%s)
while true; do
  COUNT=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM scores WHERE scene_id='$SCENE_ID'" 2>/dev/null | tr -d ' ')
  echo "  Scores: ${COUNT:-0}/240"
  if [ "${COUNT:-0}" -ge 240 ]; then
    echo "Pipeline complete!"
    psql "$DB_URL" -c "SELECT AVG(composite) as avg_score, MIN(composite) as min_score, MAX(composite) as max_score FROM scores WHERE scene_id='$SCENE_ID'"
    exit 0
  fi
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "Timeout after ${TIMEOUT}s"
    exit 1
  fi
  sleep 5
done
