.PHONY: up down logs reset build ps health topics db test bootstrap smoke

# ---------------------------------------------------------------------------
# Core commands
# ---------------------------------------------------------------------------

## Start the full stack (build images first)
up:
	docker compose up --build -d
	@echo ""
	@echo "Stack starting. Run 'make health' to check readiness."
	@echo "  Scene API:    http://localhost:8000"
	@echo "  Controller:   http://localhost:8001"
	@echo "  Reward:       http://localhost:8002"
	@echo "  MinIO:        http://localhost:9001"
	@echo "  Postgres:     localhost:5432"
	@echo "  Kafka:        localhost:9092 (docker) / localhost:29092 (host)"

## Stop and remove containers (volumes kept)
down:
	docker compose down

## Tail logs for all services
logs:
	docker compose logs -f --tail=100

## Stop, remove containers AND volumes – full reset
reset:
	docker compose down -v
	@echo "All volumes removed. Next 'make up' starts fresh."

# ---------------------------------------------------------------------------
# Bootstrap & Smoke Test
# ---------------------------------------------------------------------------

## Initialize infrastructure: create tables, Kafka topics, MinIO bucket
bootstrap:
	@echo "Installing bootstrap dependencies..."
	@pip install -q -r bootstrap/requirements.txt
	@echo ""
	cd bootstrap && bash bootstrap.sh

## Run smoke test: POST prompt, verify pipeline produces scene → render → frame → score
smoke:
	@pip install -q -r bootstrap/requirements.txt
	cd bootstrap && python3 smoke_test.py

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

## Build images without starting
build:
	docker compose build

## List running containers
ps:
	docker compose ps

## Check health of all HTTP services
health:
	@echo "--- scene-service ---"
	@curl -sf http://localhost:8000/health 2>/dev/null && echo "" || echo "NOT READY"
	@echo "--- controller-service ---"
	@curl -sf http://localhost:8001/health 2>/dev/null && echo "" || echo "NOT READY"
	@echo "--- reward-service ---"
	@curl -sf http://localhost:8002/health 2>/dev/null && echo "" || echo "NOT READY"

## List Kafka topics
topics:
	docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
		--bootstrap-server localhost:9092 --list

## Open psql shell
db:
	docker compose exec postgres psql -U studio -d studio

## End-to-end test: POST a prompt, poll for scores
test:
	@echo "Sending test prompt..."
	@curl -s -X POST http://localhost:8000/scene \
		-H "Content-Type: application/json" \
		-d '{"prompt":"test cube"}' | python3 -m json.tool
	@echo ""
	@echo "Check scores:  make db  →  SELECT COUNT(*) FROM scores;"
