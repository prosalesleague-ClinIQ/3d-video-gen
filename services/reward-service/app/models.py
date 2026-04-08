import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Float, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Score(Base):
    __tablename__ = "scores"

    id = Column("score_id", PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    render_id = Column(PG_UUID(as_uuid=True), nullable=False, index=True)
    scene_id = Column(PG_UUID(as_uuid=True), nullable=False)
    frame_id = Column(PG_UUID(as_uuid=True), nullable=True)
    frame_number = Column("frame_number", type_=type(0), nullable=False, default=0)
    score = Column("composite", Float, nullable=False)
    sharpness = Column(Float, nullable=False, default=0.0)
    brightness = Column("brightness", Float, nullable=False, default=0.0)
    delta_stability = Column(Float, nullable=False, default=0.0)
    model_version = Column(String(100), nullable=True)
    breakdown = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
