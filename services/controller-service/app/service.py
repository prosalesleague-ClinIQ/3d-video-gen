import logging
import uuid
from datetime import datetime, timezone, timedelta

from confluent_kafka import Producer
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.config import config
from app.models import Render, Event
from app.schemas import SceneRequestEvent, RenderCommandEvent
from app.producer import publish_render_command

logger = logging.getLogger(__name__)


def write_event(session: Session, render_id: uuid.UUID, event_type: str, payload: dict) -> Event:
    evt = Event(
        render_id=render_id,
        event_type=event_type,
        payload=payload,
    )
    session.add(evt)
    session.flush()
    return evt


def _check_idempotency(session: Session, scene_id: uuid.UUID) -> Render | None:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=config.IDEMPOTENCY_WINDOW_SECONDS)
    return (
        session.query(Render)
        .filter(
            and_(
                Render.scene_id == scene_id,
                Render.status.in_(["queued", "dispatched"]),
                Render.created_at >= cutoff,
            )
        )
        .first()
    )


def handle_scene_request(session: Session, producer: Producer, event: SceneRequestEvent) -> None:
    scene_id = event.scene_id

    # --- Idempotency check ---
    existing = _check_idempotency(session, scene_id)
    if existing:
        logger.info(
            "Skipping duplicate: scene_id=%s already has render_id=%s status=%s",
            scene_id, existing.id, existing.status,
        )
        return

    # --- Create render row (status=queued) ---
    render_id = uuid.uuid4()
    render_config = {
        "frame_start": config.DEFAULT_FRAME_START,
        "frame_end": config.DEFAULT_FRAME_END,
        "worker_profile": config.WORKER_PROFILE,
        "retry_count": 0,
        "max_retries": config.MAX_RETRIES,
    }
    render = Render(
        id=render_id,
        scene_id=scene_id,
        status="queued",
        config=render_config,
        frame_start=config.DEFAULT_FRAME_START,
        frame_end=config.DEFAULT_FRAME_END,
    )
    session.add(render)
    session.flush()

    logger.info("Created render render_id=%s scene_id=%s status=queued", render_id, scene_id)

    # --- Event: render_queued ---
    write_event(session, render_id, "render_queued", {
        "render_id": str(render_id),
        "scene_id": str(scene_id),
        "frame_start": config.DEFAULT_FRAME_START,
        "frame_end": config.DEFAULT_FRAME_END,
    })

    # --- Build and publish render.command ---
    command = RenderCommandEvent(
        render_id=render_id,
        scene_id=scene_id,
        scene_graph=event.scene_graph,
        frame_start=config.DEFAULT_FRAME_START,
        frame_end=config.DEFAULT_FRAME_END,
        worker_profile=config.WORKER_PROFILE,
        retry_count=0,
    )

    published = publish_render_command(producer, command)

    if published:
        render.status = "dispatched"
        session.flush()
        logger.info("Render dispatched render_id=%s scene_id=%s", render_id, scene_id)

        write_event(session, render_id, "render_dispatched", {
            "render_id": str(render_id),
            "scene_id": str(scene_id),
        })
    else:
        render.status = "failed"
        session.flush()
        logger.error("Render dispatch failed render_id=%s scene_id=%s", render_id, scene_id)

        write_event(session, render_id, "render_dispatch_failed", {
            "render_id": str(render_id),
            "scene_id": str(scene_id),
            "error": "kafka_publish_failed",
        })
