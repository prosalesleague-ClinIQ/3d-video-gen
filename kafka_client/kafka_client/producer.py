import logging

from aiokafka import AIOKafkaProducer
from pydantic import BaseModel

from shared.config import Settings

logger = logging.getLogger(__name__)

_producer: AIOKafkaProducer | None = None


async def _get_producer() -> AIOKafkaProducer:
    global _producer
    if _producer is None:
        settings = Settings()
        _producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            value_serializer=lambda v: v,
        )
        await _producer.start()
    return _producer


async def publish(topic: str, payload: BaseModel) -> None:
    producer = await _get_producer()
    data = payload.model_dump_json().encode("utf-8")
    await producer.send_and_wait(topic, data)
    logger.info("Published to %s: %s", topic, payload.model_dump_json()[:200])


async def close_producer() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None
