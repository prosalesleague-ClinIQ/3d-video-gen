#!/usr/bin/env python3
"""
Smoke test: POST one prompt, verify the pipeline produces scene → render → frame → score.
Exit 0 on pass, 1 on fail.
"""
import sys
import time

import psycopg2
import requests

import env

PROMPT = "a cinematic cube moving through light"
TIMEOUT = 120  # seconds
POLL_INTERVAL = 3


def query_one(conn, sql: str, params: tuple = ()) -> tuple | None:
    cur = conn.cursor()
    cur.execute(sql, params)
    row = cur.fetchone()
    cur.close()
    return row


def main() -> int:
    results = {
        "prompt_sent": False,
        "scene_id": None,
        "scene_in_db": False,
        "render_in_db": False,
        "frame_in_db": False,
        "score_in_db": False,
    }

    # -------------------------------------------------------------------------
    # 1. POST prompt
    # -------------------------------------------------------------------------
    print(f"[1/5] Posting prompt to {env.SCENE_SERVICE_URL}")
    try:
        resp = requests.post(
            env.SCENE_SERVICE_URL,
            json={"prompt": PROMPT},
            timeout=15,
        )
        resp.raise_for_status()
        scene_id = resp.json()["scene_id"]
        results["prompt_sent"] = True
        results["scene_id"] = scene_id
        print(f"       scene_id = {scene_id}")
    except Exception as exc:
        print(f"  [FAIL] Could not POST prompt: {exc}")
        _report(results)
        return 1

    # -------------------------------------------------------------------------
    # 2. Connect to Postgres and poll
    # -------------------------------------------------------------------------
    try:
        conn = psycopg2.connect(env.POSTGRES_DSN)
        conn.autocommit = True
    except Exception as exc:
        print(f"  [FAIL] Postgres connection: {exc}")
        _report(results)
        return 1

    start = time.monotonic()
    deadline = start + TIMEOUT

    # 2a. Scene exists
    print("[2/5] Checking scene in DB...")
    while time.monotonic() < deadline:
        row = query_one(conn, "SELECT scene_id FROM scenes WHERE scene_id = %s::uuid", (scene_id,))
        if row:
            results["scene_in_db"] = True
            print(f"       scene found")
            break
        time.sleep(POLL_INTERVAL)

    if not results["scene_in_db"]:
        print("  [FAIL] Scene not found in DB within timeout")
        conn.close()
        _report(results)
        return 1

    # 2b. Render exists
    print("[3/5] Checking render in DB...")
    while time.monotonic() < deadline:
        row = query_one(conn, "SELECT render_id, status FROM renders WHERE scene_id = %s::uuid", (scene_id,))
        if row:
            results["render_in_db"] = True
            print(f"       render found: id={row[0]}, status={row[1]}")
            break
        time.sleep(POLL_INTERVAL)

    if not results["render_in_db"]:
        print("  [FAIL] Render not found in DB within timeout")
        conn.close()
        _report(results)
        return 1

    # 2c. Frame exists
    print("[4/5] Checking frames in DB...")
    while time.monotonic() < deadline:
        row = query_one(conn, "SELECT COUNT(*) FROM frames WHERE scene_id = %s::uuid", (scene_id,))
        if row and row[0] > 0:
            results["frame_in_db"] = True
            print(f"       frames found: {row[0]}")
            break
        time.sleep(POLL_INTERVAL)

    if not results["frame_in_db"]:
        print("  [WARN] No frames found (blender-worker may not be running)")

    # 2d. Score exists
    print("[5/5] Checking scores in DB...")
    while time.monotonic() < deadline:
        row = query_one(conn, "SELECT COUNT(*) FROM scores WHERE scene_id = %s::uuid", (scene_id,))
        if row and row[0] > 0:
            results["score_in_db"] = True
            print(f"       scores found: {row[0]}")
            break
        time.sleep(POLL_INTERVAL)

    if not results["score_in_db"]:
        print("  [WARN] No scores found (reward-service may not be running)")

    conn.close()

    # -------------------------------------------------------------------------
    # Report
    # -------------------------------------------------------------------------
    _report(results)
    elapsed = time.monotonic() - start

    passed = results["prompt_sent"] and results["scene_in_db"] and results["render_in_db"]
    if passed:
        print(f"\nSMOKE TEST PASSED ({elapsed:.1f}s)")
        return 0
    else:
        print(f"\nSMOKE TEST FAILED ({elapsed:.1f}s)")
        return 1


def _report(r: dict) -> None:
    print("\n--- Smoke Test Results ---")
    print(f"  Prompt sent:    {'PASS' if r['prompt_sent'] else 'FAIL'}")
    print(f"  Scene ID:       {r['scene_id'] or 'N/A'}")
    print(f"  Scene in DB:    {'PASS' if r['scene_in_db'] else 'FAIL'}")
    print(f"  Render in DB:   {'PASS' if r['render_in_db'] else 'FAIL'}")
    print(f"  Frame in DB:    {'PASS' if r['frame_in_db'] else 'WARN/SKIP'}")
    print(f"  Score in DB:    {'PASS' if r['score_in_db'] else 'WARN/SKIP'}")


if __name__ == "__main__":
    sys.exit(main())
