#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# wait-for-deps.sh — block until Postgres and Kafka are reachable.
# Used as an entrypoint wrapper or pre-start script.
#
# Usage:  ./scripts/wait-for-deps.sh [command...]
#         If a command is supplied it is exec'd after deps are ready.
# ---------------------------------------------------------------------------
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
KAFKA_HOST="${KAFKA_HOST:-kafka}"
KAFKA_PORT="${KAFKA_PORT:-9092}"
MAX_RETRIES="${MAX_RETRIES:-30}"
RETRY_INTERVAL="${RETRY_INTERVAL:-2}"

wait_for_port() {
  local host="$1" port="$2" label="$3"
  local attempt=0
  echo "Waiting for ${label} at ${host}:${port}..."
  while ! (echo > /dev/tcp/"$host"/"$port") 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$MAX_RETRIES" ]; then
      echo "ERROR: ${label} not reachable after ${MAX_RETRIES} attempts" >&2
      exit 1
    fi
    sleep "$RETRY_INTERVAL"
  done
  echo "${label} is up."
}

wait_for_port "$POSTGRES_HOST" "$POSTGRES_PORT" "Postgres"
wait_for_port "$KAFKA_HOST"    "$KAFKA_PORT"    "Kafka"

echo "All dependencies ready."

# Exec into the real command if one was supplied
if [ $# -gt 0 ]; then
  exec "$@"
fi
