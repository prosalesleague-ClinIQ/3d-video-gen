"""
FastAPI service: async render pattern to avoid proxy timeouts.

  POST /generate           → returns {render_id, status: "pending"} immediately
  GET  /status/{render_id} → poll for progress
  GET  /video/{render_id}  → stream MP4 when ready
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
from threading import Lock, Thread

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
RENDER_TIMEOUT = int(os.environ.get("RENDER_TIMEOUT", "600"))

VIDEO_DIR.mkdir(parents=True, exist_ok=True)
FRAMES_DIR.mkdir(parents=True, exist_ok=True)

# In-memory job registry (single-worker container, no need for Redis)
_jobs: dict[str, dict] = {}
_jobs_lock = Lock()

app = FastAPI(
    title="3D Video Gen — Live Demo",
    description="Prompt → 3D Blender render → MP4 (async polling)",
    version="2.0.0",
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
    status: str = "pending"


class StatusResponse(BaseModel):
    render_id: str
    status: str
    progress: int = 0
    stage: str = ""
    video_url: str | None = None
    scene_graph: dict | None = None
    render_ms: float | None = None
    frames: int | None = None
    error: str | None = None


def _set_job(render_id: str, **kwargs) -> None:
    with _jobs_lock:
        if render_id not in _jobs:
            _jobs[render_id] = {"render_id": render_id, "status": "pending", "progress": 0, "stage": "queued"}
        _jobs[render_id].update(kwargs)


def _get_job(render_id: str) -> dict | None:
    with _jobs_lock:
        return _jobs.get(render_id)


def _run_render(render_id: str, prompt: str) -> None:
    t0 = time.monotonic()
    try:
        _set_job(render_id, status="running", progress=5, stage="building_scene")

        # 1. Scene graph
        graph = build_scene_graph(prompt)
        _set_job(render_id, scene_graph=graph, progress=15, stage="scene_ready")
        logger.info("[%s] scene graph: %d objects, asset=%s",
                    render_id, len(graph.get("objects", [])),
                    graph.get("objects", [{}])[0].get("asset"))

        # 2. Write scene graph JSON
        scene_path = FRAMES_DIR / f"{render_id}.json"
        with open(scene_path, "w") as f:
            json.dump(graph, f)

        out_frames = FRAMES_DIR / render_id
        out_frames.mkdir(parents=True, exist_ok=True)

        # 3. Launch Blender
        _set_job(render_id, progress=20, stage="rendering_frames")
        if not BLENDER_BIN or not os.path.exists(BLENDER_BIN):
            raise RuntimeError(f"Blender not found at {BLENDER_BIN}")

        cmd = [
            BLENDER_BIN, "--background",
            "--python", str(Path(__file__).parent / "blender_entrypoint.py"),
            "--", str(scene_path), str(out_frames),
        ]
        logger.info("[%s] blender: %s", render_id, " ".join(cmd))

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        frame_count = int(graph.get("frame_count", 48))
        rendered = 0

        for line in process.stdout:
            line = line.rstrip()
            if line.startswith("RENDERED frame"):
                rendered += 1
                # 20% → 85% maps to frame progress
                pct = 20 + int((rendered / frame_count) * 65)
                _set_job(
                    render_id,
                    progress=pct,
                    stage=f"rendering {rendered}/{frame_count}",
                )
            elif "ERROR" in line:
                logger.warning("[%s] blender: %s", render_id, line)

        rc = process.wait(timeout=RENDER_TIMEOUT)
        if rc != 0:
            raise RuntimeError(f"Blender exited with code {rc}")

        # 4. Compose MP4
        _set_job(render_id, progress=88, stage="composing_video")
        mp4_path = VIDEO_DIR / f"{render_id}.mp4"
        ok = compose(str(out_frames), str(mp4_path), fps=int(graph.get("fps", 24)))
        if not ok:
            raise RuntimeError("ffmpeg composition failed")

        # 5. Cleanup
        try:
            shutil.rmtree(out_frames)
            scene_path.unlink(missing_ok=True)
        except Exception:
            pass

        elapsed_ms = (time.monotonic() - t0) * 1000.0
        _set_job(
            render_id,
            status="complete",
            progress=100,
            stage="complete",
            video_url=f"/video/{render_id}",
            render_ms=elapsed_ms,
            frames=frame_count,
        )
        logger.info("[%s] complete in %.1fs", render_id, elapsed_ms / 1000)

    except Exception as exc:
        logger.exception("[%s] render failed", render_id)
        _set_job(render_id, status="failed", stage="error", error=str(exc))


@app.get("/")
def root():
    with _jobs_lock:
        active = sum(1 for j in _jobs.values() if j["status"] in ("pending", "running"))
    return {
        "service": "3d-video-gen",
        "status": "ok",
        "blender": BLENDER_BIN,
        "blender_exists": os.path.exists(BLENDER_BIN) if BLENDER_BIN else False,
        "active_jobs": active,
        "total_jobs": len(_jobs),
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    render_id = uuid.uuid4().hex[:12]
    logger.info("[%s] queueing prompt: %r", render_id, req.prompt)

    _set_job(render_id, status="pending", progress=0, stage="queued", prompt=req.prompt)

    # Thread, not async task — blocking subprocess shouldn't block event loop
    Thread(target=_run_render, args=(render_id, req.prompt), daemon=True).start()

    return GenerateResponse(render_id=render_id, status="pending")


@app.get("/status/{render_id}", response_model=StatusResponse)
def status(render_id: str):
    job = _get_job(render_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown render_id")
    return StatusResponse(**job)


@app.get("/video/{render_id}")
def get_video(render_id: str):
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
