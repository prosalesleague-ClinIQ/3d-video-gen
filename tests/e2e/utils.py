"""E2E test utilities — DB queries, HTTP calls, polling helpers."""
import glob
import logging
import os
import time
from typing import Any, Callable

import psycopg2
import requests

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def submit_prompt(url: str, prompt: str) -> dict:
    resp = requests.post(url, json={"prompt": prompt}, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    logger.info("POST %s → %d  scene_id=%s", url, resp.status_code, data.get("scene_id"))
    return data


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db_connection(dsn: str):
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    return conn


def _query(conn, sql: str, params: tuple = ()) -> list[dict]:
    cur = conn.cursor()
    cur.execute(sql, params)
    if cur.description is None:
        cur.close()
        return []
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    return rows


def fetch_scene(conn, scene_id: str) -> dict | None:
    rows = _query(conn, "SELECT * FROM scenes WHERE scene_id = %s::uuid", (scene_id,))
    return rows[0] if rows else None


def fetch_render_for_scene(conn, scene_id: str) -> dict | None:
    rows = _query(
        conn,
        "SELECT * FROM renders WHERE scene_id = %s::uuid ORDER BY created_at DESC LIMIT 1",
        (scene_id,),
    )
    return rows[0] if rows else None


def fetch_frames_for_render(conn, render_id: str) -> list[dict]:
    return _query(
        conn,
        "SELECT * FROM frames WHERE render_id = %s::uuid ORDER BY frame_number",
        (render_id,),
    )


def fetch_scores_for_render(conn, render_id: str) -> list[dict]:
    return _query(
        conn,
        "SELECT * FROM scores WHERE render_id = %s::uuid ORDER BY frame_number",
        (render_id,),
    )


# ---------------------------------------------------------------------------
# Polling
# ---------------------------------------------------------------------------

def wait_until(
    predicate: Callable[[], Any],
    timeout: float,
    interval: float = 2.0,
    label: str = "",
) -> Any:
    deadline = time.monotonic() + timeout
    last_result = None
    while time.monotonic() < deadline:
        last_result = predicate()
        if last_result:
            return last_result
        remaining = deadline - time.monotonic()
        logger.debug("Waiting for %s (%.0fs remaining)...", label, remaining)
        time.sleep(interval)
    return last_result


# ---------------------------------------------------------------------------
# Storage verification
# ---------------------------------------------------------------------------

def maybe_verify_local_frame(render_id: str, root: str) -> str | None:
    patterns = [
        os.path.join(root, render_id, "frame_*.png"),
        os.path.join(root, render_id, "*.png"),
        os.path.join(root, str(render_id), "frame_*.png"),
        os.path.join(root, str(render_id), "*.png"),
    ]
    for pattern in patterns:
        matches = glob.glob(pattern)
        if matches:
            logger.info("Found %d local frames matching %s", len(matches), pattern)
            return matches[0]
    return None


def maybe_verify_minio_frame(render_id: str, endpoint: str, access_key: str,
                              secret_key: str, bucket: str) -> str | None:
    try:
        from minio import Minio
        client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=False)
        objects = list(client.list_objects(bucket, prefix=f"{render_id}/", recursive=True))
        if objects:
            logger.info("Found %d objects in MinIO for render %s", len(objects), render_id)
            return objects[0].object_name
    except Exception as exc:
        logger.debug("MinIO check skipped: %s", exc)
    return None
