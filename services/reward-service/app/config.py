import os


class Config:
    DATABASE_URL: str = os.environ.get(
        "DATABASE_URL",
        os.environ.get(
            "STUDIO_DATABASE_URL",
            "postgresql://studio:studio@postgres:5432/studio",
        ),
    ).replace("postgresql+asyncpg://", "postgresql://")

    KAFKA_BROKERS: str = os.environ.get(
        "KAFKA_BROKERS",
        os.environ.get("STUDIO_KAFKA_BOOTSTRAP_SERVERS", "kafka:9092"),
    )

    FRAME_OUTPUT_TOPIC: str = os.environ.get("FRAME_OUTPUT_TOPIC", "frame.output")
    REWARD_SCORE_TOPIC: str = os.environ.get("REWARD_SCORE_TOPIC", "reward.score")
    CONSUMER_GROUP: str = os.environ.get("CONSUMER_GROUP", "reward-service-group")

    LOCAL_FRAME_ROOT: str = os.environ.get(
        "LOCAL_FRAME_ROOT",
        os.environ.get("STUDIO_FRAME_STORAGE_PATH", "/data/frames"),
    )

    OBJECT_STORAGE_ENABLED: bool = os.environ.get("OBJECT_STORAGE_ENABLED", "false").lower() == "true"
    MINIO_ENDPOINT: str = os.environ.get("MINIO_ENDPOINT", "minio:9000")
    MINIO_ACCESS_KEY: str = os.environ.get("MINIO_ACCESS_KEY", "minio")
    MINIO_SECRET_KEY: str = os.environ.get("MINIO_SECRET_KEY", "minio123")
    MINIO_BUCKET: str = os.environ.get("MINIO_BUCKET", "studio-frames")
    MINIO_SECURE: bool = os.environ.get("MINIO_SECURE", "false").lower() == "true"

    MODEL_VERSION: str = os.environ.get("MODEL_VERSION", "mvp-heuristic-v1")
    WORKER_ID: str = os.environ.get("WORKER_ID", "reward-service-1")


config = Config()
