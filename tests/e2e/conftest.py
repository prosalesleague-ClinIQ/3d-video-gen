import os
from dataclasses import dataclass

import pytest

from tests.e2e.utils import get_db_connection


@dataclass
class E2EConfig:
    scene_service_url: str
    database_url: str
    kafka_brokers: str
    timeout: float
    poll_interval: float
    minio_enabled: bool
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str
    local_frame_root: str


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


@pytest.fixture(scope="session")
def config() -> E2EConfig:
    return E2EConfig(
        scene_service_url=_env("SCENE_SERVICE_URL", "http://localhost:8000/scene"),
        database_url=_env("DATABASE_URL", "postgresql://studio:studio@localhost:5432/studio"),
        kafka_brokers=_env("KAFKA_BROKERS", "localhost:9092"),
        timeout=float(_env("E2E_TIMEOUT_SECONDS", "180")),
        poll_interval=float(_env("E2E_POLL_INTERVAL_SECONDS", "2")),
        minio_enabled=_env("MINIO_ENABLED", "false").lower() == "true",
        minio_endpoint=_env("MINIO_ENDPOINT", "localhost:9000"),
        minio_access_key=_env("MINIO_ACCESS_KEY", "minio"),
        minio_secret_key=_env("MINIO_SECRET_KEY", "minio123"),
        minio_bucket=_env("MINIO_BUCKET", "studio-frames"),
        local_frame_root=_env("LOCAL_FRAME_ROOT", "./data/frames"),
    )


@pytest.fixture(scope="session")
def db_conn(config):
    conn = get_db_connection(config.database_url)
    yield conn
    conn.close()
