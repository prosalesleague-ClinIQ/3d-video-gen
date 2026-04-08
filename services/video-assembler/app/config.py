import os


class Config:
    KAFKA_BROKERS: str = os.environ.get(
        "KAFKA_BROKERS",
        os.environ.get("STUDIO_KAFKA_BOOTSTRAP_SERVERS", "kafka:9092"),
    )
    RENDER_LIFECYCLE_TOPIC: str = os.environ.get("RENDER_LIFECYCLE_TOPIC", "render.lifecycle")
    RENDER_EVENT_TOPIC: str = os.environ.get("RENDER_EVENT_TOPIC", "render.event")
    VIDEO_COMPLETE_TOPIC: str = os.environ.get("VIDEO_COMPLETE_TOPIC", "video.complete")
    CONSUMER_GROUP: str = os.environ.get("CONSUMER_GROUP", "video-assembler-group")

    FRAME_ROOT: str = os.environ.get(
        "FRAME_ROOT",
        os.environ.get("STUDIO_FRAME_STORAGE_PATH", "/data/frames"),
    )
    VIDEO_OUTPUT_PATH: str = os.environ.get("VIDEO_OUTPUT_PATH", "/data/videos")

    FPS: int = int(os.environ.get("FPS", "24"))
    VIDEO_CODEC: str = os.environ.get("VIDEO_CODEC", "libx264")
    VIDEO_QUALITY: str = os.environ.get("VIDEO_QUALITY", "23")  # CRF value
    FFMPEG_BINARY: str = os.environ.get("FFMPEG_BINARY", "ffmpeg")


config = Config()
