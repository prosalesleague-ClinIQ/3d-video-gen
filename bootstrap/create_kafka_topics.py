#!/usr/bin/env python3
"""Create Kafka topics. Idempotent — ignores 'already exists' errors."""
import sys

from kafka.admin import KafkaAdminClient, NewTopic
from kafka.errors import TopicAlreadyExistsError

import env

TOPICS = [
    "scene.request",
    "render.command",
    "frame.output",
    "reward.score",
    "render.event",
    "render.lifecycle",
]

PARTITIONS = int(env.get("KAFKA_PARTITIONS", "3"))
REPLICATION = int(env.get("KAFKA_REPLICATION", "1"))


def main() -> int:
    print(f"Connecting to Kafka at {env.KAFKA_BROKERS}")
    try:
        admin = KafkaAdminClient(bootstrap_servers=env.KAFKA_BROKERS)
    except Exception as exc:
        print(f"  [FAIL] Cannot connect: {exc}", file=sys.stderr)
        return 1

    existing = set(admin.list_topics())
    to_create = []

    for name in TOPICS:
        if name in existing:
            print(f"  [SKIP] {name} (exists)")
        else:
            to_create.append(
                NewTopic(name=name, num_partitions=PARTITIONS, replication_factor=REPLICATION)
            )

    if to_create:
        try:
            admin.create_topics(new_topics=to_create, validate_only=False)
            for t in to_create:
                print(f"  [OK] {t.name}")
        except TopicAlreadyExistsError:
            print("  [OK] Topics already exist (race condition, safe)")
        except Exception as exc:
            print(f"  [FAIL] {exc}", file=sys.stderr)
            admin.close()
            return 1

    admin.close()
    print("All topics ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
