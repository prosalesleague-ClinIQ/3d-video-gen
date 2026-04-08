import logging
import sys

from app.config import config
from app.kafka_client import create_producer
from app.consumer import run_consumer_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("controller-service")


def main() -> None:
    logger.info("Controller-service starting")
    logger.info("  kafka=%s", config.KAFKA_BROKERS)
    logger.info("  db=%s", config.DATABASE_URL.split("@")[-1] if "@" in config.DATABASE_URL else "***")
    logger.info("  consume=%s  produce=%s", config.SCENE_REQUEST_TOPIC, config.RENDER_COMMAND_TOPIC)
    logger.info("  frames=%d-%d  profile=%s  max_retries=%d",
                config.DEFAULT_FRAME_START, config.DEFAULT_FRAME_END,
                config.WORKER_PROFILE, config.MAX_RETRIES)

    producer = create_producer()

    try:
        run_consumer_loop(producer)
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt received")
    finally:
        producer.flush(timeout=5)
        logger.info("Controller-service stopped")


if __name__ == "__main__":
    main()
