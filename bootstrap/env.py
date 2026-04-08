"""Shared env loader for bootstrap scripts."""
import os


def get(key: str, default: str) -> str:
    return os.environ.get(key, default)


POSTGRES_HOST = get("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(get("POSTGRES_PORT", "5432"))
POSTGRES_DB = get("POSTGRES_DB", "studio")
POSTGRES_USER = get("POSTGRES_USER", "studio")
POSTGRES_PASSWORD = get("POSTGRES_PASSWORD", "studio")
POSTGRES_DSN = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

KAFKA_BROKERS = get("KAFKA_BROKERS", "localhost:9092")

MINIO_ENDPOINT = get("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = get("MINIO_ACCESS_KEY", "minio")
MINIO_SECRET_KEY = get("MINIO_SECRET_KEY", "minio123")
MINIO_BUCKET = get("MINIO_BUCKET", "studio-frames")
MINIO_SECURE = get("MINIO_SECURE", "false").lower() == "true"

SCENE_SERVICE_URL = get("SCENE_SERVICE_URL", "http://localhost:8000/scene")
