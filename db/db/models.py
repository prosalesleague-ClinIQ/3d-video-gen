import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Text, String, Float, Integer
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Scene(Base):
    __tablename__ = "scenes"

    scene_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    scene_graph: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=_utcnow)


class Render(Base):
    __tablename__ = "renders"

    render_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scene_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("scenes.scene_id"), nullable=False)
    frame_start: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    frame_end: Mapped[int] = mapped_column(Integer, nullable=False, default=240)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=_utcnow, onupdate=_utcnow)


class Frame(Base):
    __tablename__ = "frames"

    frame_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    render_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("renders.render_id"), nullable=False)
    scene_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("scenes.scene_id"), nullable=False)
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=_utcnow)


class Event(Base):
    __tablename__ = "events"

    event_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    topic: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=_utcnow)


class Score(Base):
    __tablename__ = "scores"

    score_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    render_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("renders.render_id"), nullable=False)
    scene_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("scenes.scene_id"), nullable=False)
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)
    sharpness: Mapped[float] = mapped_column(Float, nullable=False)
    brightness: Mapped[float] = mapped_column(Float, nullable=False)
    delta_stability: Mapped[float] = mapped_column(Float, nullable=False)
    composite: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=_utcnow)
