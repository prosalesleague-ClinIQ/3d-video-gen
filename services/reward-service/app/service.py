import logging
import uuid

from confluent_kafka import Producer
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.config import config
from app.models import Score
from app.schemas import FrameOutputEvent, RewardScoreEvent, ScoreBreakdown
from app.scorer import load_image, score_frame
from app.kafka_client import publish

logger = logging.getLogger(__name__)

# In-memory cache: render_id -> last loaded image (numpy array)
_previous_frames: dict[str, "numpy.ndarray"] = {}


def _lookup_frame_id(session: Session, render_id: uuid.UUID, frame_index: int) -> uuid.UUID | None:
    try:
        from sqlalchemy import text
        row = session.execute(
            text("SELECT frame_id FROM frames WHERE render_id = :rid AND frame_number = :fn LIMIT 1"),
            {"rid": str(render_id), "fn": frame_index},
        ).fetchone()
        return row[0] if row else None
    except Exception:
        return None


def handle_frame_output(session: Session, producer: Producer, event: FrameOutputEvent) -> None:
    render_id = event.render_id
    scene_id = event.scene_id
    frame_index = event.resolved_frame_index()
    image_uri = event.resolved_uri()

    # Load current frame
    current = load_image(image_uri)
    if current is None:
        logger.error(
            "Cannot load image, skipping: render_id=%s frame=%d uri=%s",
            render_id, frame_index, image_uri,
        )
        return

    # Get previous frame for temporal consistency
    render_key = str(render_id)
    previous = _previous_frames.get(render_key)

    # Score
    composite, breakdown = score_frame(current, previous)

    # Update cache
    _previous_frames[render_key] = current

    # Lookup frame_id
    frame_id = _lookup_frame_id(session, render_id, frame_index)

    # Store in DB
    score_row = Score(
        render_id=render_id,
        scene_id=scene_id,
        frame_id=frame_id,
        frame_number=frame_index,
        score=composite,
        sharpness=breakdown["sharpness"],
        brightness=breakdown["brightness_stability"],
        delta_stability=breakdown["temporal_consistency"],
        model_version=config.MODEL_VERSION,
        breakdown=breakdown,
    )
    session.add(score_row)
    session.flush()

    logger.info(
        "Scored frame=%d render_id=%s composite=%.3f sharp=%.3f bright=%.3f temporal=%.3f comp=%.3f",
        frame_index, render_id,
        composite,
        breakdown["sharpness"],
        breakdown["brightness_stability"],
        breakdown["temporal_consistency"],
        breakdown["composition"],
    )

    # Publish reward.score
    reward_event = RewardScoreEvent(
        render_id=render_id,
        scene_id=scene_id,
        frame_index=frame_index,
        score=composite,
        model_version=config.MODEL_VERSION,
        breakdown=ScoreBreakdown(**breakdown),
    )
    publish(
        producer,
        config.REWARD_SCORE_TOPIC,
        reward_event.model_dump(mode="json"),
        key=str(render_id),
    )
