import json
import logging

from confluent_kafka import Consumer, Producer, KafkaError

from app.config import config

logger = logging.getLogger(__name__)


def create_consumer(topics: list[str], group_id: str | None = None) -> Consumer:
    conf = {
        "bootstrap.servers": config.KAFKA_BROKERS,
        "group.id": group_id or config.CONSUMER_GROUP,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
    }
    consumer = Consumer(conf)
    consumer.subscribe(topics)
    logger.info("Subscribed to %s as group %s", topics, conf["group.id"])
    return consumer


def create_producer() -> Producer:
    conf = {
        "bootstrap.servers": config.KAFKA_BROKERS,
        "acks": "all",
    }
    return Producer(conf)


def deserialize(value: bytes) -> dict:
    return json.loads(value.decode("utf-8"))


def serialize(obj: dict) -> bytes:
    return json.dumps(obj, default=str).encode("utf-8")
