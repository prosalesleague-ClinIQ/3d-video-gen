#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run_e2e.sh — run E2E pipeline test against live docker-compose stack
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

# Defaults (override via env or .env)
export SCENE_SERVICE_URL="${SCENE_SERVICE_URL:-http://localhost:8000/scene}"
export DATABASE_URL="${DATABASE_URL:-postgresql://studio:studio@localhost:5432/studio}"
export KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:9092}"
export E2E_TIMEOUT_SECONDS="${E2E_TIMEOUT_SECONDS:-180}"
export E2E_POLL_INTERVAL_SECONDS="${E2E_POLL_INTERVAL_SECONDS:-2}"
export MINIO_ENABLED="${MINIO_ENABLED:-false}"
export LOCAL_FRAME_ROOT="${LOCAL_FRAME_ROOT:-./data/frames}"

echo "=== E2E Pipeline Test ==="
echo "  scene-service: $SCENE_SERVICE_URL"
echo "  database:      $DATABASE_URL"
echo "  timeout:       ${E2E_TIMEOUT_SECONDS}s"
echo ""

pip install -q pytest requests psycopg2-binary minio 2>/dev/null

exec pytest tests/e2e/test_pipeline.py -v -s --tb=short --log-cli-level=INFO "$@"
