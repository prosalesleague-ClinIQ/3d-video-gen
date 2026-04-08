"""Initial tables

Revision ID: 001
Revises:
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scenes",
        sa.Column("scene_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("prompt", sa.Text, nullable=False),
        sa.Column("seed", sa.Integer, nullable=False),
        sa.Column("scene_graph", JSONB, nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "renders",
        sa.Column("render_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("scene_id", UUID(as_uuid=True), sa.ForeignKey("scenes.scene_id"), nullable=False),
        sa.Column("frame_start", sa.Integer, nullable=False, server_default="0"),
        sa.Column("frame_end", sa.Integer, nullable=False, server_default="240"),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "frames",
        sa.Column("frame_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("render_id", UUID(as_uuid=True), sa.ForeignKey("renders.render_id"), nullable=False),
        sa.Column("scene_id", UUID(as_uuid=True), sa.ForeignKey("scenes.scene_id"), nullable=False),
        sa.Column("frame_number", sa.Integer, nullable=False),
        sa.Column("file_path", sa.Text, nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "events",
        sa.Column("event_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("topic", sa.String(100), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "scores",
        sa.Column("score_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("render_id", UUID(as_uuid=True), sa.ForeignKey("renders.render_id"), nullable=False),
        sa.Column("scene_id", UUID(as_uuid=True), sa.ForeignKey("scenes.scene_id"), nullable=False),
        sa.Column("frame_number", sa.Integer, nullable=False),
        sa.Column("sharpness", sa.Float, nullable=False),
        sa.Column("brightness", sa.Float, nullable=False),
        sa.Column("delta_stability", sa.Float, nullable=False),
        sa.Column("composite", sa.Float, nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("scores")
    op.drop_table("events")
    op.drop_table("frames")
    op.drop_table("renders")
    op.drop_table("scenes")
