import logging
import signal
import sys

from confluent_kafka import Consumer, Producer, KafkaError

from app.config import config
from app.db import get_session
from app.kafka_client import create_consumer, deserialize
from app.schemas import SceneRequestEvent
from app.service import handle_scene_request

logger = logging.getLogger(__name__)

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    logger.info("Received signal %d, shutting down gracefully...", signum)
    _shutdown = True


def run_consumer_loop(producer: Producer) -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    consumer = create_consumer([config.SCENE_REQUEST_TOPIC])
    logger.info("Consumer loop started, polling %s", config.SCENE_REQUEST_TOPIC)

    try:
        while not _shutdown:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                logger.error("Consumer error: %s", msg.error())
                continue

            try:
                raw = deserialize(msg.value())
                event = SceneRequestEvent(**raw)
                logger.info(
                    "Received scene.request scene_id=%s offset=%d",
                    event.scene_id, msg.offset(),
                )

                with get_session() as session:
                    handle_scene_request(session, producer, event)

                consumer.commit(message=msg)

            except Exception:
                logger.exception(
                    "Failed to process message offset=%d partition=%d",
                    msg.offset(), msg.partition(),
                )

    finally:
        consumer.close()
        logger.info("Consumer closed")
