import json
import uuid
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Scene, Render, Frame, Event, Score
from shared.enums import RenderStatus
from shared.schemas import SceneGraph


async def create_scene(session: AsyncSession, graph: SceneGraph) -> Scene:
    scene = Scene(
        scene_id=graph.scene_id,
        prompt=graph.prompt,
        seed=graph.seed,
        scene_graph=json.loads(graph.model_dump_json()),
    )
    session.add(scene)
    await session.commit()
    return scene


async def create_render(
    session: AsyncSession,
    scene_id: UUID,
    frame_start: int = 0,
    frame_end: int = 240,
) -> Render:
    render = Render(
        render_id=uuid.uuid4(),
        scene_id=scene_id,
        frame_start=frame_start,
        frame_end=frame_end,
        status=RenderStatus.PENDING.value,
    )
    session.add(render)
    await session.commit()
    return render


async def update_render_status(session: AsyncSession, render_id: UUID, status: RenderStatus) -> None:
    render = await session.get(Render, render_id)
    if render:
        render.status = status.value
        await session.commit()


async def create_frame(
    session: AsyncSession,
    render_id: UUID,
    scene_id: UUID,
    frame_number: int,
    file_path: str,
) -> Frame:
    frame = Frame(
        render_id=render_id,
        scene_id=scene_id,
        frame_number=frame_number,
        file_path=file_path,
    )
    session.add(frame)
    await session.commit()
    return frame


async def create_score(
    session: AsyncSession,
    render_id: UUID,
    scene_id: UUID,
    frame_number: int,
    sharpness: float,
    brightness: float,
    delta_stability: float,
    composite: float,
) -> Score:
    score = Score(
        render_id=render_id,
        scene_id=scene_id,
        frame_number=frame_number,
        sharpness=sharpness,
        brightness=brightness,
        delta_stability=delta_stability,
        composite=composite,
    )
    session.add(score)
    await session.commit()
    return score


async def log_event(session: AsyncSession, topic: str, payload: dict) -> Event:
    event = Event(topic=topic, payload=payload)
    session.add(event)
    await session.commit()
    return event
