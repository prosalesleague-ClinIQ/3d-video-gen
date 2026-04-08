import logging
import signal
import sys

from confluent_kafka import KafkaError

from app.config import config
from app.kafka_client import create_consumer, create_producer, deserialize, publish
from app.assembler import assemble_video

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("video-assembler")

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    logger.info("Signal %d received, shutting down...", signum)
    _shutdown = True


def main() -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info("Video assembler starting")
    logger.info("  kafka=%s", config.KAFKA_BROKERS)
    logger.info("  listen=%s %s", config.RENDER_LIFECYCLE_TOPIC, config.RENDER_EVENT_TOPIC)
    logger.info("  frames=%s  videos=%s", config.FRAME_ROOT, config.VIDEO_OUTPUT_PATH)
    logger.info("  fps=%d  codec=%s  crf=%s", config.FPS, config.VIDEO_CODEC, config.VIDEO_QUALITY)

    producer = create_producer()
    consumer = create_consumer([config.RENDER_LIFECYCLE_TOPIC, config.RENDER_EVENT_TOPIC])

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

                # Accept both event schemas
                event_type = raw.get("event_type") or raw.get("event") or ""
                render_id = raw.get("render_id", "")
                scene_id = raw.get("scene_id", "")

                if event_type not in ("render_completed",):
                    consumer.commit(message=msg)
                    continue

                logger.info("Render completed: render_id=%s scene_id=%s — assembling video", render_id, scene_id)

                video_path = assemble_video(str(render_id), str(scene_id))

                if video_path:
                    publish(producer, config.VIDEO_COMPLETE_TOPIC, {
                        "render_id": str(render_id),
                        "scene_id": str(scene_id),
                        "video_path": video_path,
                        "status": "complete",
                    }, key=str(render_id))
                    producer.flush(timeout=5)
                    logger.info("Video published: render_id=%s path=%s", render_id, video_path)
                else:
                    logger.error("Video assembly failed: render_id=%s", render_id)

                consumer.commit(message=msg)

            except Exception:
                logger.exception("Failed to process message offset=%d", msg.offset())

    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt")
    finally:
        consumer.close()
        producer.flush(timeout=5)
        logger.info("Video assembler stopped")


if __name__ == "__main__":
    main()
