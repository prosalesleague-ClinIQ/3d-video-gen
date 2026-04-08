#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run_local.sh — one-command local stack startup
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Building and starting stack ==="
docker compose up --build -d

echo ""
echo "=== Waiting for infrastructure ==="

echo -n "Postgres..."
until docker compose exec -T postgres pg_isready -U studio -q 2>/dev/null; do
  sleep 2
  echo -n "."
done
echo " ready"

echo -n "Kafka..."
until docker compose exec -T kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server localhost:9092 --list >/dev/null 2>&1; do
  sleep 3
  echo -n "."
done
echo " ready"

echo ""
echo "=== Running migrations ==="
docker compose exec -T scene-service python -c "
import asyncio
from db.models import Base
from db.session import get_engine
async def migrate():
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
asyncio.run(migrate())
print('Tables created.')
"

echo ""
echo "=== Stack ready ==="
echo "  Scene API:    http://localhost:8000"
echo "  Controller:   http://localhost:8001/health"
echo "  Reward:       http://localhost:8002/health"
echo "  MinIO:        http://localhost:9001"
echo "  Postgres:     localhost:5432 (user: studio / pass: studio)"
echo "  Kafka:        localhost:29092 (host access)"
echo ""
echo "Test:"
echo '  curl -X POST http://localhost:8000/scene -H "Content-Type: application/json" -d '\''{"prompt":"test cube"}'\'''
echo ""
echo "Logs:  docker compose logs -f"
echo "Stop:  docker compose down"
echo "Reset: docker compose down -v"
