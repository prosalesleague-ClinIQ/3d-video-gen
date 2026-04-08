import logging
import signal
import sys

from confluent_kafka import KafkaError

from app.config import config
from app.db import get_session
from app.kafka_client import create_consumer, create_producer, deserialize
from app.schemas import FrameOutputEvent
from app.service import handle_frame_output

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("reward-service")

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    logger.info("Received signal %d, shutting down gracefully...", signum)
    _shutdown = True


def main() -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info("Reward service starting")
    logger.info("  worker_id=%s  model=%s", config.WORKER_ID, config.MODEL_VERSION)
    logger.info("  kafka=%s", config.KAFKA_BROKERS)
    logger.info("  consume=%s  produce=%s", config.FRAME_OUTPUT_TOPIC, config.REWARD_SCORE_TOPIC)
    logger.info("  db=%s", config.DATABASE_URL.split("@")[-1] if "@" in config.DATABASE_URL else "***")
    logger.info("  frame_root=%s  object_storage=%s", config.LOCAL_FRAME_ROOT, config.OBJECT_STORAGE_ENABLED)

    producer = create_producer()
    consumer = create_consumer([config.FRAME_OUTPUT_TOPIC])

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
                event = FrameOutputEvent(**raw)
                logger.debug(
                    "Received frame.output render_id=%s frame=%d offset=%d",
                    event.render_id, event.resolved_frame_index(), msg.offset(),
                )

                with get_session() as session:
                    handle_frame_output(session, producer, event)

                consumer.commit(message=msg)

            except Exception:
                logger.exception(
                    "Failed to process message offset=%d partition=%d",
                    msg.offset(), msg.partition(),
                )

    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt received")
    finally:
        consumer.close()
        producer.flush(timeout=5)
        logger.info("Reward service stopped")


if __name__ == "__main__":
    main()
