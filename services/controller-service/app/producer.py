import logging

from confluent_kafka import Producer

from app.config import config
from app.kafka_client import serialize
from app.schemas import RenderCommandEvent

logger = logging.getLogger(__name__)


def _delivery_report(err, msg):
    if err:
        logger.error("Delivery failed for render.command: %s", err)
    else:
        logger.debug("Delivered to %s [%d] @ %d", msg.topic(), msg.partition(), msg.offset())


def publish_render_command(producer: Producer, command: RenderCommandEvent) -> bool:
    try:
        payload = serialize(command.model_dump(mode="json"))
        producer.produce(
            topic=config.RENDER_COMMAND_TOPIC,
            value=payload,
            key=str(command.render_id).encode("utf-8"),
            callback=_delivery_report,
        )
        producer.flush(timeout=10)
        logger.info(
            "Published render.command render_id=%s scene_id=%s",
            command.render_id, command.scene_id,
        )
        return True
    except Exception:
        logger.exception(
            "Failed to publish render.command render_id=%s scene_id=%s",
            command.render_id, command.scene_id,
        )
        return False
