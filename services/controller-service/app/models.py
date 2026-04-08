import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Integer, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Render(Base):
    __tablename__ = "renders"

    id = Column("render_id", PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scene_id = Column(PG_UUID(as_uuid=True), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="queued")
    worker_id = Column(String(100), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    frame_start = Column(Integer, nullable=False, default=0)
    frame_end = Column(Integer, nullable=False, default=240)


class Event(Base):
    __tablename__ = "events"

    id = Column("event_id", PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    render_id = Column(PG_UUID(as_uuid=True), nullable=True)
    event_type = Column("topic", String(100), nullable=False)
    payload = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
