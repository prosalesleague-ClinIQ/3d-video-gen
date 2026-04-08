#!/usr/bin/env bash
set -euo pipefail

echo "Starting infrastructure..."
docker compose up -d postgres kafka

echo "Waiting for Postgres..."
until docker compose exec postgres pg_isready -U studio; do
  sleep 2
done

echo "Running migrations..."
cd db && alembic upgrade head && cd ..

echo "Starting services..."
docker compose up -d scene-generator controller blender-worker reward

echo "All services running. API at http://localhost:8000"
echo "Test: curl -X POST http://localhost:8000/scene -H 'Content-Type: application/json' -d '{\"prompt\":\"test cube\"}'"
