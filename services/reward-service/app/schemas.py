from uuid import UUID

from pydantic import BaseModel, Field


class FrameMetrics(BaseModel):
    render_time_ms: float = 0.0
    worker_id: str = ""


class FrameOutputEvent(BaseModel):
    render_id: UUID
    scene_id: UUID
    frame_index: int = 0
    frame_number: int | None = None
    timestamp: float = 0.0
    image_uri: str = ""
    file_path: str = ""
    hash: str = ""
    image_hash: str = ""
    metrics: FrameMetrics = Field(default_factory=FrameMetrics)

    def resolved_uri(self) -> str:
        return self.image_uri or self.file_path or ""

    def resolved_frame_index(self) -> int:
        if self.frame_index:
            return self.frame_index
        if self.frame_number is not None:
            return self.frame_number
        return 0


class ScoreBreakdown(BaseModel):
    sharpness: float = 0.0
    brightness_stability: float = 0.0
    temporal_consistency: float = 0.0
    composition: float = 0.0


class RewardScoreEvent(BaseModel):
    render_id: UUID
    scene_id: UUID
    frame_index: int = 0
    score: float = 0.0
    model_version: str = ""
    breakdown: ScoreBreakdown = Field(default_factory=ScoreBreakdown)
