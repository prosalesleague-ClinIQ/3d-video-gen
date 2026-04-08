from uuid import UUID

from pydantic import BaseModel, Field


class RenderCommandEvent(BaseModel):
    render_id: UUID
    scene_id: UUID
    scene_graph: dict = Field(default_factory=dict)
    frame_start: int = 0
    frame_end: int = 240
    worker_profile: str = "gpu"
    retry_count: int = 0


class FrameMetrics(BaseModel):
    render_time_ms: float = 0.0
    worker_id: str = ""


class FrameOutputEvent(BaseModel):
    render_id: UUID
    scene_id: UUID
    frame_index: int
    timestamp: float = 0.0
    image_uri: str = ""
    hash: str = ""
    metrics: FrameMetrics = Field(default_factory=FrameMetrics)


class RenderEvent(BaseModel):
    render_id: UUID
    scene_id: UUID
    event: str
    frame_index: int | None = None
    error: str | None = None
