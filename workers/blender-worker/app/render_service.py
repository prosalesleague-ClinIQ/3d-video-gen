import logging
import time
from uuid import UUID

from confluent_kafka import Producer

from app.config import config
from app.schemas import RenderCommandEvent, FrameOutputEvent, FrameMetrics, RenderEvent
from app.kafka_client import publish
from app.storage import frame_path, frame_uri
from app.hash_utils import sha256_file
from app.blender_runtime import build_scene, render_frame

logger = logging.getLogger(__name__)


def _emit_event(producer: Producer, render_id: UUID, scene_id: UUID, event: str,
                frame_index: int | None = None, error: str | None = None) -> None:
    evt = RenderEvent(
        render_id=render_id,
        scene_id=scene_id,
        event=event,
        frame_index=frame_index,
        error=error,
    )
    publish(producer, config.RENDER_EVENT_TOPIC, evt.model_dump(mode="json"), key=str(render_id))


def process_render_command(producer: Producer, cmd: RenderCommandEvent) -> None:
    render_id = cmd.render_id
    scene_id = cmd.scene_id
    logger.info("Processing render render_id=%s scene_id=%s frames=%d-%d",
                render_id, scene_id, cmd.frame_start, cmd.frame_end)

    _emit_event(producer, render_id, scene_id, "render_started")

    try:
        build_scene(
            scene_graph=cmd.scene_graph,
            engine=config.BLENDER_ENGINE,
            samples=config.BLENDER_SAMPLES,
            use_gpu=config.BLENDER_USE_GPU,
        )

        fps = cmd.scene_graph.get("fps", 24)

        for fi in range(cmd.frame_start, cmd.frame_end):
            out_path = frame_path(str(render_id), fi)

            t0 = time.monotonic()
            render_frame(fi, out_path)
            render_time_ms = (time.monotonic() - t0) * 1000.0

            file_hash = sha256_file(out_path)
            uri = frame_uri(str(render_id), fi, out_path)

            frame_out = FrameOutputEvent(
                render_id=render_id,
                scene_id=scene_id,
                frame_index=fi,
                timestamp=fi / fps if fps > 0 else 0.0,
                image_uri=uri,
                hash=file_hash,
                metrics=FrameMetrics(
                    render_time_ms=render_time_ms,
                    worker_id=config.WORKER_ID,
                ),
            )
            publish(
                producer,
                config.FRAME_OUTPUT_TOPIC,
                frame_out.model_dump(mode="json"),
                key=str(render_id),
            )

            _emit_event(producer, render_id, scene_id, "frame_complete", frame_index=fi)

            logger.info(
                "frame=%d/%d render_id=%s hash=%s time=%.0fms",
                fi, cmd.frame_end, render_id, file_hash[:12], render_time_ms,
            )

        producer.flush(timeout=10)
        _emit_event(producer, render_id, scene_id, "render_completed")
        logger.info("Render complete render_id=%s", render_id)

    except Exception as exc:
        logger.exception("Render failed render_id=%s", render_id)
        _emit_event(producer, render_id, scene_id, "render_failed", error=str(exc))
        producer.flush(timeout=5)
