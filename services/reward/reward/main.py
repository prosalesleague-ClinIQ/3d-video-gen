import asyncio
import logging
import uuid

from db.session import get_session_factory
from db.crud import create_score, log_event
from kafka_client import consume, publish, FRAME_OUTPUT, REWARD_SCORE
from shared.config import Settings
from shared.schemas import FrameOutput, RewardScore
from reward.metrics import sharpness, brightness_consistency, delta_stability, composite_score

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = Settings(service_name="reward")
session_factory = get_session_factory(settings)

_previous_frames: dict[str, str] = {}


async def handle_frame_output(frame: FrameOutput) -> None:
    scene_key = str(frame.scene_id)
    prev_path = _previous_frames.get(scene_key)

    sharp = sharpness(frame.file_path)
    bright = brightness_consistency(frame.file_path)
    delta = delta_stability(frame.file_path, prev_path)
    comp = composite_score(sharp, bright, delta)

    _previous_frames[scene_key] = frame.file_path

    score = RewardScore(
        score_id=uuid.uuid4(),
        render_id=frame.render_id,
        scene_id=frame.scene_id,
        frame_number=frame.frame_number,
        sharpness=sharp,
        brightness=bright,
        delta_stability=delta,
        composite=comp,
    )

    async with session_factory() as session:
        await create_score(
            session,
            render_id=frame.render_id,
            scene_id=frame.scene_id,
            frame_number=frame.frame_number,
            sharpness=sharp,
            brightness=bright,
            delta_stability=delta,
            composite=comp,
        )
        await publish(REWARD_SCORE, score)
        await log_event(session, REWARD_SCORE, score.model_dump(mode="json"))

    logger.info(
        "Scored frame %d scene %s: sharp=%.3f bright=%.3f delta=%.3f composite=%.3f",
        frame.frame_number, frame.scene_id, sharp, bright, delta, comp,
    )


async def main():
    logger.info("Reward service starting...")
    await consume(FRAME_OUTPUT, handle_frame_output, FrameOutput)


if __name__ == "__main__":
    asyncio.run(main())
