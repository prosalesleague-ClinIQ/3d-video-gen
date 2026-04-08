import hashlib
import math
from datetime import datetime, timezone
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL

from pydantic import BaseModel, ConfigDict, Field


def _seed_from_prompt(prompt: str) -> int:
    return int(hashlib.sha256(prompt.encode()).hexdigest()[:8], 16)


def _scene_id_from_prompt(prompt: str, seed: int) -> UUID:
    return uuid5(NAMESPACE_URL, f"{prompt}-{seed}")


class Keyframe(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    frame: int
    value: list[float]


class CameraParams(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    position: list[float] = Field(default=[7.36, -6.93, 4.96])
    rotation: list[float] = Field(default=[1.1093, 0.0, 0.8149])
    lens: float = 50.0
    keyframes: list[Keyframe] = Field(default_factory=list)


class LightParams(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    position: list[float] = Field(default=[4.08, 1.0, 5.90])
    energy: float = 1000.0
    light_type: str = "AREA"
    size: float = 5.0


class ObjectParams(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str = "Cube"
    obj_type: str = "CUBE"
    position: list[float] = Field(default=[0.0, 0.0, 0.0])
    scale: list[float] = Field(default=[1.0, 1.0, 1.0])
    color: list[float] = Field(default=[0.8, 0.2, 0.2, 1.0])
    keyframes: list[Keyframe] = Field(default_factory=list)


class SceneGraph(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    scene_id: UUID
    prompt: str
    seed: int
    camera: CameraParams
    objects: list[ObjectParams]
    light: LightParams
    frame_count: int = 240
    resolution_x: int = 512
    resolution_y: int = 512
    samples: int = 32
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @classmethod
    def from_prompt(cls, prompt: str) -> "SceneGraph":
        seed = _seed_from_prompt(prompt)
        scene_id = _scene_id_from_prompt(prompt, seed)
        rng_energy = 500.0 + (seed % 1500)
        r = ((seed >> 0) & 0xFF) / 255.0
        g = ((seed >> 8) & 0xFF) / 255.0
        b = ((seed >> 16) & 0xFF) / 255.0

        obj_keyframes = [
            Keyframe(frame=1, value=[0.0, 0.0, 0.0]),
            Keyframe(frame=240, value=[0.0, 0.0, 2 * math.pi]),
        ]
        obj = ObjectParams(
            name="Cube",
            obj_type="CUBE",
            position=[0.0, 0.0, 0.0],
            scale=[1.0, 1.0, 1.0],
            color=[r, g, b, 1.0],
            keyframes=obj_keyframes,
        )

        cam_radius = 10.0
        cam_keyframes = [
            Keyframe(frame=1, value=[cam_radius, 0.0, 4.96]),
            Keyframe(frame=60, value=[0.0, cam_radius, 4.96]),
            Keyframe(frame=120, value=[-cam_radius, 0.0, 4.96]),
            Keyframe(frame=180, value=[0.0, -cam_radius, 4.96]),
            Keyframe(frame=240, value=[cam_radius, 0.0, 4.96]),
        ]
        camera = CameraParams(
            position=[cam_radius, 0.0, 4.96],
            rotation=[1.1093, 0.0, 0.8149],
            keyframes=cam_keyframes,
        )

        light = LightParams(
            energy=rng_energy,
            light_type="AREA",
            size=5.0,
        )

        return cls(
            scene_id=scene_id,
            prompt=prompt,
            seed=seed,
            camera=camera,
            objects=[obj],
            light=light,
        )


class SceneRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    scene_id: UUID
    scene_graph: SceneGraph


class RenderCommand(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    render_id: UUID
    scene_id: UUID
    scene_graph: SceneGraph
    frame_start: int = 0
    frame_end: int = 240


class FrameMetrics(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    render_time_ms: float = 0.0


class FrameOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    render_id: UUID
    scene_id: UUID
    frame_number: int
    file_path: str
    image_hash: str = ""
    width: int = 512
    height: int = 512
    metrics: FrameMetrics = Field(default_factory=FrameMetrics)


class RenderLifecycleEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    render_id: UUID
    scene_id: UUID
    event_type: str  # render_started, frame_complete, render_failed, render_completed
    frame_number: int | None = None
    error: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RewardScore(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    score_id: UUID
    render_id: UUID
    scene_id: UUID
    frame_number: int
    sharpness: float
    brightness: float
    delta_stability: float
    composite: float
