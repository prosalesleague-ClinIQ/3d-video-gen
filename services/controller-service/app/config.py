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

    SCENE_REQUEST_TOPIC: str = os.environ.get("SCENE_REQUEST_TOPIC", "scene.request")
    RENDER_COMMAND_TOPIC: str = os.environ.get("RENDER_COMMAND_TOPIC", "render.command")
    RENDER_EVENT_TOPIC: str = os.environ.get("RENDER_EVENT_TOPIC", "render.event")

    CONSUMER_GROUP: str = os.environ.get("CONSUMER_GROUP", "controller-service-group")
    WORKER_PROFILE: str = os.environ.get("WORKER_PROFILE", "gpu")

    DEFAULT_FRAME_START: int = int(os.environ.get("DEFAULT_FRAME_START", "0"))
    DEFAULT_FRAME_END: int = int(os.environ.get("DEFAULT_FRAME_END", "240"))
    MAX_RETRIES: int = int(os.environ.get("MAX_RETRIES", "3"))

    IDEMPOTENCY_WINDOW_SECONDS: int = int(os.environ.get("IDEMPOTENCY_WINDOW_SECONDS", "60"))


config = Config()
