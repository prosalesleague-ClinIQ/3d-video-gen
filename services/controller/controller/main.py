import asyncio
import logging
import uuid

from db.session import get_session_factory
from db.crud import create_render, update_render_status, log_event
from kafka_client import consume, publish, SCENE_REQUEST, RENDER_COMMAND
from shared.config import Settings
from shared.enums import RenderStatus
from shared.schemas import SceneRequest, RenderCommand

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = Settings(service_name="controller")
session_factory = get_session_factory(settings)


async def handle_scene_request(req: SceneRequest) -> None:
    async with session_factory() as session:
        render = await create_render(
            session,
            scene_id=req.scene_id,
            frame_start=0,
            frame_end=req.scene_graph.frame_count,
        )
        cmd = RenderCommand(
            render_id=render.render_id,
            scene_id=req.scene_id,
            scene_graph=req.scene_graph,
            frame_start=0,
            frame_end=req.scene_graph.frame_count,
        )
        await publish(RENDER_COMMAND, cmd)
        await update_render_status(session, render.render_id, RenderStatus.RENDERING)
        await log_event(session, RENDER_COMMAND, cmd.model_dump(mode="json"))
    logger.info("Dispatched render %s for scene %s", render.render_id, req.scene_id)


async def main():
    logger.info("Controller starting...")
    await consume(SCENE_REQUEST, handle_scene_request, SceneRequest)


if __name__ == "__main__":
    asyncio.run(main())
