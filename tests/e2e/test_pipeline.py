"""
E2E pipeline test: prompt → scene → render → frame → score.

Runs against the live docker-compose stack. Verifies wiring, not full
240-frame completion — first frame + first score is sufficient proof.
"""
import logging

import pytest

from tests.e2e.utils import (
    submit_prompt,
    fetch_scene,
    fetch_render_for_scene,
    fetch_frames_for_render,
    fetch_scores_for_render,
    wait_until,
    maybe_verify_local_frame,
    maybe_verify_minio_frame,
)

logger = logging.getLogger(__name__)

PROMPT = "a cinematic cube moving through light"


class TestPipeline:

    def test_prompt_to_first_scored_frame(self, config, db_conn):
        """Full pipeline: submit prompt → verify scene, render, frame, score in DB."""

        # ---- 1. Submit prompt ------------------------------------------------
        logger.info("Step 1: Submitting prompt")
        data = submit_prompt(config.scene_service_url, PROMPT)
        scene_id = data["scene_id"]
        assert scene_id, "scene_id missing from response"
        logger.info("Got scene_id=%s", scene_id)

        # ---- 2. Scene exists in DB ------------------------------------------
        logger.info("Step 2: Waiting for scene in DB")
        scene = wait_until(
            lambda: fetch_scene(db_conn, scene_id),
            timeout=config.timeout,
            interval=config.poll_interval,
            label="scene in DB",
        )
        assert scene is not None, f"Scene {scene_id} not found in DB within {config.timeout}s"
        assert scene["prompt"] == PROMPT
        logger.info("Scene found: prompt=%s", scene["prompt"])

        # ---- 3. Render exists in DB -----------------------------------------
        logger.info("Step 3: Waiting for render in DB")
        render = wait_until(
            lambda: fetch_render_for_scene(db_conn, scene_id),
            timeout=config.timeout,
            interval=config.poll_interval,
            label="render in DB",
        )
        assert render is not None, f"Render for scene {scene_id} not found in DB within {config.timeout}s"
        render_id = str(render["render_id"])
        logger.info("Render found: render_id=%s status=%s", render_id, render.get("status"))

        # ---- 4. At least one frame in DB ------------------------------------
        logger.info("Step 4: Waiting for first frame in DB")
        frames = wait_until(
            lambda: fetch_frames_for_render(db_conn, render_id),
            timeout=config.timeout,
            interval=config.poll_interval,
            label="frames in DB",
        )
        assert frames, f"No frames found for render {render_id} within {config.timeout}s"
        logger.info("Frames found: %d", len(frames))

        # ---- 5. At least one score in DB ------------------------------------
        logger.info("Step 5: Waiting for first score in DB")
        scores = wait_until(
            lambda: fetch_scores_for_render(db_conn, render_id),
            timeout=config.timeout,
            interval=config.poll_interval,
            label="scores in DB",
        )
        assert scores, f"No scores found for render {render_id} within {config.timeout}s"
        first_score = scores[0]
        logger.info(
            "Score found: frame=%s composite=%.3f sharpness=%.3f",
            first_score.get("frame_number"),
            first_score.get("composite", 0),
            first_score.get("sharpness", 0),
        )
        assert 0.0 <= first_score.get("composite", -1) <= 1.0, "Composite score out of range"

        # ---- 6. Verify local frame file (optional) --------------------------
        local_frame = maybe_verify_local_frame(render_id, config.local_frame_root)
        if local_frame:
            logger.info("Local frame verified: %s", local_frame)
        else:
            logger.info("Local frame check skipped (volume may not be host-mounted)")

        # ---- 7. Verify MinIO frame (optional) -------------------------------
        if config.minio_enabled:
            minio_obj = maybe_verify_minio_frame(
                render_id,
                config.minio_endpoint,
                config.minio_access_key,
                config.minio_secret_key,
                config.minio_bucket,
            )
            if minio_obj:
                logger.info("MinIO frame verified: %s", minio_obj)
            else:
                logger.warning("MinIO enabled but no frames found for render %s", render_id)

        # ---- Report ---------------------------------------------------------
        logger.info("")
        logger.info("=== E2E PIPELINE TEST PASSED ===")
        logger.info("  scene_id:   %s", scene_id)
        logger.info("  render_id:  %s", render_id)
        logger.info("  frames:     %d", len(frames))
        logger.info("  scores:     %d", len(scores))
        logger.info("  composite:  %.3f", first_score.get("composite", 0))
