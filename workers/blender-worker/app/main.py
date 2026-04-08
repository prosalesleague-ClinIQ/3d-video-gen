import logging
import signal
import sys

from confluent_kafka import KafkaError

from app.config import config
from app.kafka_client import create_consumer, create_producer, deserialize
from app.schemas import RenderCommandEvent
from app.render_service import process_render_command

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("blender-worker")

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    logger.info("Received signal %d, shutting down gracefully...", signum)
    _shutdown = True


def main() -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info("Blender worker starting")
    logger.info("  worker_id=%s", config.WORKER_ID)
    logger.info("  kafka=%s", config.KAFKA_BROKERS)
    logger.info("  consume=%s  produce=%s", config.RENDER_COMMAND_TOPIC, config.FRAME_OUTPUT_TOPIC)
    logger.info("  engine=%s samples=%d gpu=%s", config.BLENDER_ENGINE, config.BLENDER_SAMPLES, config.BLENDER_USE_GPU)
    logger.info("  output=%s  object_storage=%s", config.OUTPUT_PATH, config.OBJECT_STORAGE_ENABLED)

    producer = create_producer()
    consumer = create_consumer([config.RENDER_COMMAND_TOPIC])

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
                cmd = RenderCommandEvent(**raw)
                logger.info(
                    "Received render.command render_id=%s scene_id=%s offset=%d",
                    cmd.render_id, cmd.scene_id, msg.offset(),
                )

                process_render_command(producer, cmd)
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
        logger.info("Blender worker stopped")


if __name__ == "__main__":
    main()
