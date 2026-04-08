from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="STUDIO_")

    database_url: str = "postgresql+asyncpg://studio:studio@localhost:5432/studio"
    kafka_bootstrap_servers: str = "localhost:9092"
    frame_storage_path: str = "/data/frames"
    service_name: str = "unknown"
