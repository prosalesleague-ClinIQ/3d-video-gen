#!/usr/bin/env python3
"""Create all tables in Postgres. Idempotent — safe to run repeatedly."""
import sys

import psycopg2
from psycopg2 import sql

import env

TABLES = {
    "scenes": """
        CREATE TABLE IF NOT EXISTS scenes (
            scene_id    UUID PRIMARY KEY,
            prompt      TEXT NOT NULL,
            seed        INTEGER NOT NULL,
            scene_graph JSONB NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """,
    "renders": """
        CREATE TABLE IF NOT EXISTS renders (
            render_id   UUID PRIMARY KEY,
            scene_id    UUID NOT NULL REFERENCES scenes(scene_id),
            frame_start INTEGER NOT NULL DEFAULT 0,
            frame_end   INTEGER NOT NULL DEFAULT 240,
            status      VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            created_at  TIMESTAMPTZ DEFAULT now(),
            updated_at  TIMESTAMPTZ DEFAULT now()
        )
    """,
    "frames": """
        CREATE TABLE IF NOT EXISTS frames (
            frame_id     UUID PRIMARY KEY,
            render_id    UUID NOT NULL REFERENCES renders(render_id),
            scene_id     UUID NOT NULL REFERENCES scenes(scene_id),
            frame_number INTEGER NOT NULL,
            file_path    TEXT NOT NULL,
            created_at   TIMESTAMPTZ DEFAULT now()
        )
    """,
    "events": """
        CREATE TABLE IF NOT EXISTS events (
            event_id   UUID PRIMARY KEY,
            topic      VARCHAR(100) NOT NULL,
            payload    JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """,
    "scores": """
        CREATE TABLE IF NOT EXISTS scores (
            score_id        UUID PRIMARY KEY,
            render_id       UUID NOT NULL REFERENCES renders(render_id),
            scene_id        UUID NOT NULL REFERENCES scenes(scene_id),
            frame_number    INTEGER NOT NULL,
            sharpness       DOUBLE PRECISION NOT NULL,
            brightness      DOUBLE PRECISION NOT NULL,
            delta_stability DOUBLE PRECISION NOT NULL,
            composite       DOUBLE PRECISION NOT NULL,
            created_at      TIMESTAMPTZ DEFAULT now()
        )
    """,
    "training_dataset": """
        CREATE TABLE IF NOT EXISTS training_dataset (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            scene_id    UUID REFERENCES scenes(scene_id),
            render_id   UUID REFERENCES renders(render_id),
            prompt      TEXT,
            frame_count INTEGER,
            avg_score   DOUBLE PRECISION,
            metadata    JSONB DEFAULT '{}',
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """,
}


def main() -> int:
    print(f"Connecting to Postgres at {env.POSTGRES_HOST}:{env.POSTGRES_PORT}/{env.POSTGRES_DB}")
    try:
        conn = psycopg2.connect(env.POSTGRES_DSN)
        conn.autocommit = True
        cur = conn.cursor()

        for name, ddl in TABLES.items():
            cur.execute(ddl)
            print(f"  [OK] {name}")

        cur.close()
        conn.close()
        print("All tables ready.")
        return 0
    except Exception as exc:
        print(f"  [FAIL] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
