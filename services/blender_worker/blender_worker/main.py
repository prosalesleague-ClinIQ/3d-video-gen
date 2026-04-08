import asyncio
import logging

from kafka_client import consume, close_producer, RENDER_COMMAND
from kafka_client.consumer import request_shutdown
from shared.config import Settings
from shared.schemas import RenderCommand
from blender_worker.scene_builder import build_bpy_scene
from blender_worker.renderer import render_frames, _emit_lifecycle

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

settings = Settings(service_name="blender-worker")


async def handle_render_command(cmd: RenderCommand) -> None:
    logger.info("Received render command: render_id=%s scene_id=%s frames=%d-%d",
                cmd.render_id, cmd.scene_id, cmd.frame_start, cmd.frame_end)
    build_bpy_scene(cmd.scene_graph)
    await render_frames(
        render_id=cmd.render_id,
        scene_id=cmd.scene_id,
        frame_start=cmd.frame_start,
        frame_end=cmd.frame_end,
    )


async def main() -> None:
    logger.info("Blender worker starting (service=%s)", settings.service_name)
    try:
        await consume(RENDER_COMMAND, handle_render_command, RenderCommand)
    finally:
        await close_producer()
        logger.info("Blender worker shut down cleanly")


if __name__ == "__main__":
    asyncio.run(main())
