import logging

from fastapi import FastAPI
from pydantic import BaseModel

from db.session import get_session_factory
from db.crud import create_scene, log_event
from kafka_client import publish, SCENE_REQUEST
from shared.config import Settings
from shared.schemas import SceneRequest
from scene_generator.generator import build_scene_graph

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = Settings(service_name="scene-generator")
app = FastAPI(title="Scene Generator")
session_factory = get_session_factory(settings)


class PromptRequest(BaseModel):
    prompt: str


class SceneResponse(BaseModel):
    scene_id: str


@app.post("/scene", response_model=SceneResponse)
async def create_scene_endpoint(req: PromptRequest):
    graph = build_scene_graph(req.prompt)
    async with session_factory() as session:
        await create_scene(session, graph)
        scene_req = SceneRequest(scene_id=graph.scene_id, scene_graph=graph)
        await publish(SCENE_REQUEST, scene_req)
        await log_event(session, SCENE_REQUEST, scene_req.model_dump(mode="json"))
    logger.info("Created scene %s for prompt: %s", graph.scene_id, req.prompt)
    return SceneResponse(scene_id=str(graph.scene_id))


@app.get("/health")
async def health():
    return {"status": "ok"}
