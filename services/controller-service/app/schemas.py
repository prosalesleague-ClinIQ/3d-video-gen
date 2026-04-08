from uuid import UUID

from pydantic import BaseModel, Field


class SceneRequestEvent(BaseModel):
    scene_id: UUID
    prompt: str = ""
    scene_graph: dict = Field(default_factory=dict)
    version: int = 1


class RenderCommandEvent(BaseModel):
    render_id: UUID
    scene_id: UUID
    scene_graph: dict = Field(default_factory=dict)
    frame_start: int = 0
    frame_end: int = 240
    worker_profile: str = "gpu"
    retry_count: int = 0
