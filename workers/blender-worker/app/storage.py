import logging
import os

from app.config import config

logger = logging.getLogger(__name__)


def ensure_output_dir(render_id: str) -> str:
    out = os.path.join(config.OUTPUT_PATH, render_id)
    os.makedirs(out, exist_ok=True)
    return out


def frame_path(render_id: str, frame_index: int) -> str:
    out = ensure_output_dir(render_id)
    return os.path.join(out, f"frame_{frame_index:04d}.png")


def frame_uri(render_id: str, frame_index: int, local_path: str) -> str:
    if config.OBJECT_STORAGE_ENABLED:
        return _upload_to_object_storage(render_id, frame_index, local_path)
    return f"file://{local_path}"


def _upload_to_object_storage(render_id: str, frame_index: int, local_path: str) -> str:
    try:
        from minio import Minio

        client = Minio(
            config.MINIO_ENDPOINT,
            access_key=config.MINIO_ACCESS_KEY,
            secret_key=config.MINIO_SECRET_KEY,
            secure=config.MINIO_SECURE,
        )
        object_name = f"{render_id}/frame_{frame_index:04d}.png"
        client.fput_object(config.MINIO_BUCKET, object_name, local_path)
        proto = "https" if config.MINIO_SECURE else "http"
        uri = f"s3://{config.MINIO_BUCKET}/{object_name}"
        logger.debug("Uploaded %s to %s", local_path, uri)
        return uri
    except Exception:
        logger.exception("Object storage upload failed, falling back to local")
        return f"file://{local_path}"
