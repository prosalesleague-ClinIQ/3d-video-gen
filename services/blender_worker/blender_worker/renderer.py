import hashlib
import logging
import os
import time
from uuid import UUID

import bpy

from db.session import get_session_factory
from db.crud import create_frame, update_render_status, log_event
from kafka_client import publish, FRAME_OUTPUT, RENDER_LIFECYCLE
from shared.config import Settings
from shared.enums import RenderStatus
from shared.schemas import FrameOutput, FrameMetrics, RenderLifecycleEvent

logger = logging.getLogger(__name__)
settings = Settings(service_name="blender-worker")


def _hash_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


async def _emit_lifecycle(
    render_id: UUID,
    scene_id: UUID,
    event_type: str,
    frame_number: int | None = None,
    error: str | None = None,
) -> None:
    evt = RenderLifecycleEvent(
        render_id=render_id,
        scene_id=scene_id,
        event_type=event_type,
        frame_number=frame_number,
        error=error,
    )
    await publish(RENDER_LIFECYCLE, evt)
    session_factory = get_session_factory(settings)
    async with session_factory() as session:
        await log_event(session, RENDER_LIFECYCLE, evt.model_dump(mode="json"))


async def render_frames(
    render_id: UUID,
    scene_id: UUID,
    frame_start: int,
    frame_end: int,
) -> None:
    storage_path = settings.frame_storage_path
    scene_dir = os.path.join(storage_path, str(scene_id))
    os.makedirs(scene_dir, exist_ok=True)

    session_factory = get_session_factory(settings)
    scene = bpy.context.scene

    await _emit_lifecycle(render_id, scene_id, "render_started")

    try:
        for frame_num in range(frame_start, frame_end):
            frame_idx = frame_num + 1  # Blender is 1-indexed
            scene.frame_set(frame_idx)
            file_path = os.path.join(scene_dir, f"{frame_num:04d}.png")
            scene.render.filepath = file_path

            t0 = time.monotonic()
            bpy.ops.render.render(write_still=True)
            render_time_ms = (time.monotonic() - t0) * 1000.0

            image_hash = _hash_file(file_path)

            output = FrameOutput(
                render_id=render_id,
                scene_id=scene_id,
                frame_number=frame_num,
                file_path=file_path,
                image_hash=image_hash,
                width=scene.render.resolution_x,
                height=scene.render.resolution_y,
                metrics=FrameMetrics(render_time_ms=render_time_ms),
            )

            async with session_factory() as session:
                await create_frame(session, render_id, scene_id, frame_num, file_path)
                await publish(FRAME_OUTPUT, output)

            await _emit_lifecycle(render_id, scene_id, "frame_complete", frame_number=frame_num)
            logger.info(
                "frame=%d/%d scene=%s hash=%s time=%.0fms",
                frame_num, frame_end, scene_id, image_hash[:12], render_time_ms,
            )

        async with session_factory() as session:
            await update_render_status(session, render_id, RenderStatus.DONE)
        await _emit_lifecycle(render_id, scene_id, "render_completed")
        logger.info("Render complete: render_id=%s", render_id)

    except Exception as exc:
        logger.exception("Render failed: render_id=%s", render_id)
        async with session_factory() as session:
            await update_render_status(session, render_id, RenderStatus.FAILED)
        await _emit_lifecycle(render_id, scene_id, "render_failed", error=str(exc))
        raise
