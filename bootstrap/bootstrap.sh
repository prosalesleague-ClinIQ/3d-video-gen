#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# bootstrap.sh — initialize local infrastructure
#
# Waits for Postgres, Kafka, MinIO, then runs:
#   seed_db.py, create_kafka_topics.py, create_minio_bucket.py
#
# Exit non-zero on any failure.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Defaults (override via env or .env)
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:9092}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost:9000}"

MAX_RETRIES="${MAX_RETRIES:-30}"
RETRY_INTERVAL="${RETRY_INTERVAL:-2}"

# ---------------------------------------------------------------------------
wait_for_tcp() {
  local host="$1" port="$2" label="$3"
  local attempt=0
  echo -n "Waiting for ${label} (${host}:${port})..."
  while ! (echo > /dev/tcp/"$host"/"$port") 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$MAX_RETRIES" ]; then
      echo " TIMEOUT"
      echo "ERROR: ${label} not reachable after ${MAX_RETRIES} attempts" >&2
      exit 1
    fi
    echo -n "."
    sleep "$RETRY_INTERVAL"
  done
  echo " ready"
}

# ---------------------------------------------------------------------------
# Extract host:port for kafka and minio
# ---------------------------------------------------------------------------
KAFKA_HOST="${KAFKA_BROKERS%%:*}"
KAFKA_PORT="${KAFKA_BROKERS##*:}"

MINIO_HOST="${MINIO_ENDPOINT%%:*}"
MINIO_PORT="${MINIO_ENDPOINT##*:}"

echo "=== Studio Bootstrap ==="
echo ""

wait_for_tcp "$POSTGRES_HOST" "$POSTGRES_PORT" "Postgres"
wait_for_tcp "$KAFKA_HOST"    "$KAFKA_PORT"    "Kafka"
wait_for_tcp "$MINIO_HOST"    "$MINIO_PORT"    "MinIO"

echo ""
echo "=== Seeding database ==="
python3 seed_db.py
echo ""

echo "=== Creating Kafka topics ==="
python3 create_kafka_topics.py
echo ""

echo "=== Creating MinIO bucket ==="
python3 create_minio_bucket.py
echo ""

echo "=== Bootstrap complete ==="
