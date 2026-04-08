import asyncio
import logging
import signal
from collections.abc import Callable, Awaitable
from typing import TypeVar

from aiokafka import AIOKafkaConsumer
from pydantic import BaseModel

from shared.config import Settings

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

_shutdown_event: asyncio.Event | None = None


def _get_shutdown_event() -> asyncio.Event:
    global _shutdown_event
    if _shutdown_event is None:
        _shutdown_event = asyncio.Event()
    return _shutdown_event


def request_shutdown() -> None:
    ev = _get_shutdown_event()
    ev.set()


async def consume(
    topic: str,
    handler: Callable[[T], Awaitable[None]],
    schema_cls: type[T],
    group_id: str | None = None,
) -> None:
    settings = Settings()
    gid = group_id or f"{settings.service_name}-group"
    shutdown = _get_shutdown_event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, request_shutdown)

    consumer = AIOKafkaConsumer(
        topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=gid,
        auto_offset_reset="earliest",
        enable_auto_commit=False,
    )
    await consumer.start()
    logger.info("Consuming from %s as %s", topic, gid)
    try:
        async for msg in consumer:
            if shutdown.is_set():
                logger.info("Shutdown requested, draining current message...")
                break
            try:
                parsed = schema_cls.model_validate_json(msg.value)
                await handler(parsed)
                await consumer.commit()
            except Exception:
                logger.exception("Error processing message from %s", topic)
            if shutdown.is_set():
                break
    finally:
        await consumer.stop()
        logger.info("Consumer stopped for %s", topic)
