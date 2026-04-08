import json
import logging

from confluent_kafka import Consumer, Producer

from app.config import config

logger = logging.getLogger(__name__)


def create_consumer(topics: list[str]) -> Consumer:
    conf = {
        "bootstrap.servers": config.KAFKA_BROKERS,
        "group.id": config.CONSUMER_GROUP,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
    }
    consumer = Consumer(conf)
    consumer.subscribe(topics)
    logger.info("Subscribed to %s", topics)
    return consumer


def create_producer() -> Producer:
    return Producer({"bootstrap.servers": config.KAFKA_BROKERS, "acks": "all"})


def deserialize(value: bytes) -> dict:
    return json.loads(value.decode("utf-8"))


def serialize(obj: dict) -> bytes:
    return json.dumps(obj, default=str).encode("utf-8")


def publish(producer: Producer, topic: str, payload: dict, key: str | None = None) -> None:
    producer.produce(topic=topic, value=serialize(payload), key=key.encode("utf-8") if key else None)
    producer.poll(0)
