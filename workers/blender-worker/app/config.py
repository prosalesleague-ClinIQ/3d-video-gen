import os


class Config:
    KAFKA_BROKERS: str = os.environ.get(
        "KAFKA_BROKERS",
        os.environ.get("STUDIO_KAFKA_BOOTSTRAP_SERVERS", "kafka:9092"),
    )

    RENDER_COMMAND_TOPIC: str = os.environ.get("RENDER_COMMAND_TOPIC", "render.command")
    FRAME_OUTPUT_TOPIC: str = os.environ.get("FRAME_OUTPUT_TOPIC", "frame.output")
    RENDER_EVENT_TOPIC: str = os.environ.get("RENDER_EVENT_TOPIC", "render.event")

    CONSUMER_GROUP: str = os.environ.get("CONSUMER_GROUP", "blender-worker-group")
    WORKER_ID: str = os.environ.get("WORKER_ID", "blender-worker-1")
    OUTPUT_PATH: str = os.environ.get(
        "OUTPUT_PATH",
        os.environ.get("STUDIO_FRAME_STORAGE_PATH", "/data/frames"),
    )

    BLENDER_BINARY: str = os.environ.get("BLENDER_BINARY", "blender")
    BLENDER_USE_GPU: bool = os.environ.get("BLENDER_USE_GPU", "false").lower() == "true"
    BLENDER_ENGINE: str = os.environ.get("BLENDER_ENGINE", "CYCLES")
    BLENDER_SAMPLES: int = int(os.environ.get("BLENDER_SAMPLES", "64"))

    OBJECT_STORAGE_ENABLED: bool = os.environ.get("OBJECT_STORAGE_ENABLED", "false").lower() == "true"
    MINIO_ENDPOINT: str = os.environ.get("MINIO_ENDPOINT", "minio:9000")
    MINIO_ACCESS_KEY: str = os.environ.get("MINIO_ACCESS_KEY", "minio")
    MINIO_SECRET_KEY: str = os.environ.get("MINIO_SECRET_KEY", "minio123")
    MINIO_BUCKET: str = os.environ.get("MINIO_BUCKET", "studio-frames")
    MINIO_SECURE: bool = os.environ.get("MINIO_SECURE", "false").lower() == "true"


config = Config()
