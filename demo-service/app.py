"""
FastAPI service: POST /generate → scene graph → Blender render → MP4.
"""
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from scene_builder import build_scene_graph
from video_compose import compose

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("demo-service")

BLENDER_BIN = os.environ.get("BLENDER_BIN", shutil.which("blender") or "/usr/local/bin/blender")
VIDEO_DIR = Path(os.environ.get("VIDEO_DIR", "/tmp/videos"))
FRAMES_DIR = Path(os.environ.get("FRAMES_DIR", "/tmp/frames"))
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
RENDER_TIMEOUT = int(os.environ.get("RENDER_TIMEOUT", "600"))

VIDEO_DIR.mkdir(parents=True, exist_ok=True)
FRAMES_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="3D Video Gen — Live Demo",
    description="Prompt → 3D Blender render → MP4",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=500)


class GenerateResponse(BaseModel):
    render_id: str
    video_url: str
    scene_graph: dict
    render_ms: float
    frames: int


@app.get("/")
def root():
    return {
        "service": "3d-video-gen",
        "status": "ok",
        "blender": BLENDER_BIN,
        "blender_exists": os.path.exists(BLENDER_BIN) if BLENDER_BIN else False,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest, request: Request):
    t0 = time.monotonic()
    render_id = uuid.uuid4().hex[:12]
    logger.info("[%s] prompt: %r", render_id, req.prompt)

    # 1. Build scene graph
    graph = build_scene_graph(req.prompt)
    logger.info("[%s] scene graph: %d objects, asset=%s",
                 render_id, len(graph.get("objects", [])),
                 graph.get("objects", [{}])[0].get("asset"))

    # 2. Write scene graph to disk
    scene_path = FRAMES_DIR / f"{render_id}.json"
    with open(scene_path, "w") as f:
        json.dump(graph, f)

    out_frames = FRAMES_DIR / render_id
    out_frames.mkdir(parents=True, exist_ok=True)

    # 3. Run Blender
    if not BLENDER_BIN or not os.path.exists(BLENDER_BIN):
        raise HTTPException(status_code=500, detail=f"Blender not found at {BLENDER_BIN}")

    blender_cmd = [
        BLENDER_BIN,
        "--background",
        "--python", str(Path(__file__).parent / "blender_entrypoint.py"),
        "--",
        str(scene_path),
        str(out_frames),
    ]
    logger.info("[%s] running blender...", render_id)

    try:
        result = subprocess.run(
            blender_cmd,
            capture_output=True,
            text=True,
            timeout=RENDER_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        logger.error("[%s] blender timed out", render_id)
        raise HTTPException(status_code=504, detail="Render timed out")

    if result.returncode != 0:
        logger.error("[%s] blender failed: %s", render_id, result.stderr[-800:])
        raise HTTPException(
            status_code=500,
            detail=f"Blender rendering failed: {result.stderr[-300:]}",
        )

    # Count rendered frames
    frame_files = sorted(out_frames.glob("frame_*.png"))
    if not frame_files:
        raise HTTPException(status_code=500, detail="No frames produced")

    logger.info("[%s] rendered %d frames", render_id, len(frame_files))

    # 4. Compose MP4
    mp4_path = VIDEO_DIR / f"{render_id}.mp4"
    ok = compose(str(out_frames), str(mp4_path), fps=int(graph.get("fps", 24)))
    if not ok:
        raise HTTPException(status_code=500, detail="ffmpeg composition failed")

    # Cleanup frames
    try:
        shutil.rmtree(out_frames)
        scene_path.unlink(missing_ok=True)
    except Exception:
        pass

    elapsed_ms = (time.monotonic() - t0) * 1000.0
    logger.info("[%s] done in %.0fms", render_id, elapsed_ms)

    return GenerateResponse(
        render_id=render_id,
        video_url=f"/video/{render_id}",
        scene_graph=graph,
        render_ms=elapsed_ms,
        frames=len(frame_files),
    )


@app.get("/video/{render_id}")
def get_video(render_id: str):
    # Sanitize
    if not render_id.replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid render_id")
    mp4_path = VIDEO_DIR / f"{render_id}.mp4"
    if not mp4_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(
        str(mp4_path),
        media_type="video/mp4",
        filename=f"{render_id}.mp4",
        headers={"Cache-Control": "public, max-age=86400"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
