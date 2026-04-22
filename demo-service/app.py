"""
Studio render service: scene graph + async Blender MP4 + film compiler + director AI.

Endpoints:
  POST /direct              → director AI: direction plan OR clarifying questions
  POST /scene               → instant scene graph (no render)
  POST /scene-from-image    → photo → scene graph
  POST /generate            → scene graph + async MP4 render
  POST /generate-from-image → photo → scene graph + async MP4 render
  POST /compile-film        → stitch multiple MP4s into a single film
  GET  /status/{id}         → poll render progress
  GET  /film-status/{id}    → poll film compile progress
  GET  /video/{id}          → stream rendered MP4
  GET  /film/{id}           → stream compiled film
  GET  /health              → health check
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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from scene_builder import build_scene_graph
from video_compose import compose
from image_to_scene import image_to_scene_graph
from director_ai import interpret_prompt
from film_compiler import compile_film

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("demo-service")

BLENDER_BIN = os.environ.get("BLENDER_BIN", shutil.which("blender") or "/usr/local/bin/blender")
VIDEO_DIR = Path(os.environ.get("VIDEO_DIR", "/tmp/videos"))
FRAMES_DIR = Path(os.environ.get("FRAMES_DIR", "/tmp/frames"))
FILM_DIR = Path(os.environ.get("FILM_DIR", "/tmp/films"))
RENDER_TIMEOUT = int(os.environ.get("RENDER_TIMEOUT", "600"))

for d in (VIDEO_DIR, FRAMES_DIR, FILM_DIR):
    d.mkdir(parents=True, exist_ok=True)

_jobs: dict[str, dict] = {}
_jobs_lock = Lock()
_films: dict[str, dict] = {}
_films_lock = Lock()

app = FastAPI(
    title="3D Video Gen — Kaleidoscope Studio",
    description="Prompt/photo → interactive 3D scene + Blender MP4 + multi-scene films",
    version="4.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class DirectRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=500)
    answers: dict | None = None


class DirectResponse(BaseModel):
    type: str
    enriched_prompt: str | None = None
    shots: list[dict] | None = None
    palette: str | None = None
    lighting: str | None = None
    mood: str | None = None
    pace: str | None = None
    questions: list[dict] | None = None


class SceneRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=500)
    direction: dict | None = None


class SceneResponse(BaseModel):
    render_id: str
    scene_graph: dict


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=500)
    direction: dict | None = None


class GenerateResponse(BaseModel):
    render_id: str
    status: str = "pending"
    scene_graph: dict


class ImageSceneRequest(BaseModel):
    image: str = Field(..., description="base64 data URL or raw base64")
    direction: dict | None = None
    prompt_hint: str = ""


class ImageGenerateRequest(BaseModel):
    image: str
    direction: dict | None = None
    prompt_hint: str = ""


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


class CompileRequest(BaseModel):
    render_ids: list[str] = Field(..., min_length=1, max_length=20)
    transition: str = "cut"


class CompileResponse(BaseModel):
    film_id: str
    status: str


class FilmStatusResponse(BaseModel):
    film_id: str
    status: str
    progress: int = 0
    video_url: str | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _set_job(render_id: str, **kwargs) -> None:
    with _jobs_lock:
        if render_id not in _jobs:
            _jobs[render_id] = {
                "render_id": render_id,
                "status": "pending",
                "progress": 0,
                "stage": "queued",
            }
        _jobs[render_id].update(kwargs)


def _get_job(render_id: str) -> dict | None:
    with _jobs_lock:
        return _jobs.get(render_id)


def _effective_prompt(prompt: str, direction: dict | None) -> str:
    if direction and isinstance(direction, dict):
        enriched = direction.get("enriched_prompt")
        if enriched:
            return enriched
        extras = []
        for key in ("palette", "mood", "lighting"):
            v = direction.get(key)
            if v:
                extras.append(str(v).replace("_", " "))
        if extras:
            return f"{prompt}, {', '.join(extras)}"
    return prompt


def _run_render_with_graph(render_id: str, graph: dict) -> None:
    t0 = time.monotonic()
    try:
        _set_job(render_id, status="running", progress=10, stage="scene_ready")

        scene_path = FRAMES_DIR / f"{render_id}.json"
        with open(scene_path, "w") as f:
            json.dump(graph, f)

        out_frames = FRAMES_DIR / render_id
        out_frames.mkdir(parents=True, exist_ok=True)

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
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )

        frame_count = int(graph.get("frame_count", 72))
        rendered = 0

        for line in process.stdout:
            line = line.rstrip()
            if line.startswith("RENDERED frame"):
                rendered += 1
                pct = 20 + int((rendered / frame_count) * 65)
                _set_job(render_id, progress=pct, stage=f"rendering {rendered}/{frame_count}")
            elif "ERROR" in line:
                logger.warning("[%s] blender: %s", render_id, line)

        rc = process.wait(timeout=RENDER_TIMEOUT)
        if rc != 0:
            raise RuntimeError(f"Blender exited with code {rc}")

        _set_job(render_id, progress=88, stage="composing_video")
        mp4_path = VIDEO_DIR / f"{render_id}.mp4"
        ok = compose(str(out_frames), str(mp4_path), fps=int(graph.get("fps", 24)))
        if not ok:
            raise RuntimeError("ffmpeg composition failed")

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


def _run_compile(film_id: str, render_ids: list[str], transition: str) -> None:
    try:
        with _films_lock:
            _films[film_id] = {"film_id": film_id, "status": "running", "progress": 10}

        video_paths = []
        missing = []
        for rid in render_ids:
            p = VIDEO_DIR / f"{rid}.mp4"
            if p.exists():
                video_paths.append(str(p))
            else:
                missing.append(rid)

        if missing:
            raise RuntimeError(f"Missing videos: {missing}")

        with _films_lock:
            _films[film_id].update({"progress": 50, "stage": "stitching"})

        output = FILM_DIR / f"{film_id}.mp4"
        ok = compile_film(video_paths, str(output), transition)
        if not ok:
            raise RuntimeError("ffmpeg compilation failed")

        with _films_lock:
            _films[film_id] = {
                "film_id": film_id,
                "status": "complete",
                "progress": 100,
                "video_url": f"/film/{film_id}",
            }
        logger.info("[%s] film compiled from %d clips", film_id, len(video_paths))

    except Exception as exc:
        logger.exception("[%s] film compile failed", film_id)
        with _films_lock:
            _films[film_id] = {
                "film_id": film_id,
                "status": "failed",
                "error": str(exc),
            }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    with _jobs_lock:
        active = sum(1 for j in _jobs.values() if j["status"] in ("pending", "running"))
    return {
        "service": "3d-video-gen",
        "version": "4.0.0",
        "status": "ok",
        "blender": BLENDER_BIN,
        "blender_exists": os.path.exists(BLENDER_BIN) if BLENDER_BIN else False,
        "active_jobs": active,
        "total_jobs": len(_jobs),
        "films": len(_films),
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/direct", response_model=DirectResponse)
def direct(req: DirectRequest):
    """Director AI: returns clarifying questions or a full direction plan."""
    result = interpret_prompt(req.prompt, req.answers)
    logger.info("Director: type=%s prompt=%r", result.get("type"), req.prompt[:60])
    return DirectResponse(**result)


@app.post("/scene", response_model=SceneResponse)
def scene(req: SceneRequest):
    """Instant scene graph for Three.js. No Blender."""
    render_id = uuid.uuid4().hex[:12]
    prompt = _effective_prompt(req.prompt, req.direction)
    graph = build_scene_graph(prompt)
    graph["_direction"] = req.direction or {}
    logger.info("[%s] /scene: objects=%d", render_id, len(graph.get("objects", [])))
    return SceneResponse(render_id=render_id, scene_graph=graph)


@app.post("/scene-from-image", response_model=SceneResponse)
def scene_from_image(req: ImageSceneRequest):
    """Photo → instant scene graph. No Blender."""
    render_id = uuid.uuid4().hex[:12]
    graph = image_to_scene_graph(req.image, req.direction, req.prompt_hint)
    logger.info("[%s] /scene-from-image: objects=%d", render_id, len(graph.get("objects", [])))
    return SceneResponse(render_id=render_id, scene_graph=graph)


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    """Build scene graph + start async MP4 render."""
    render_id = uuid.uuid4().hex[:12]
    prompt = _effective_prompt(req.prompt, req.direction)
    graph = build_scene_graph(prompt)
    graph["_direction"] = req.direction or {}
    logger.info("[%s] /generate: objects=%d", render_id, len(graph.get("objects", [])))

    _set_job(
        render_id,
        status="pending",
        progress=0,
        stage="queued",
        prompt=req.prompt,
        scene_graph=graph,
    )
    Thread(target=_run_render_with_graph, args=(render_id, graph), daemon=True).start()

    return GenerateResponse(render_id=render_id, status="pending", scene_graph=graph)


@app.post("/generate-from-image", response_model=GenerateResponse)
def generate_from_image(req: ImageGenerateRequest):
    """Photo → scene graph + async MP4 render."""
    render_id = uuid.uuid4().hex[:12]
    graph = image_to_scene_graph(req.image, req.direction, req.prompt_hint)
    logger.info("[%s] /generate-from-image: objects=%d", render_id, len(graph.get("objects", [])))

    _set_job(
        render_id,
        status="pending",
        progress=0,
        stage="queued",
        prompt=f"[image] {req.prompt_hint}",
        scene_graph=graph,
    )
    Thread(target=_run_render_with_graph, args=(render_id, graph), daemon=True).start()

    return GenerateResponse(render_id=render_id, status="pending", scene_graph=graph)


@app.post("/compile-film", response_model=CompileResponse)
def compile_film_endpoint(req: CompileRequest):
    """Stitch multiple rendered MP4s into one film."""
    film_id = uuid.uuid4().hex[:12]
    with _films_lock:
        _films[film_id] = {"film_id": film_id, "status": "pending", "progress": 0}
    Thread(target=_run_compile, args=(film_id, req.render_ids, req.transition), daemon=True).start()
    logger.info("[%s] compile-film: %d clips transition=%s", film_id, len(req.render_ids), req.transition)
    return CompileResponse(film_id=film_id, status="pending")


@app.get("/status/{render_id}", response_model=StatusResponse)
def status(render_id: str):
    job = _get_job(render_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown render_id")
    return StatusResponse(**job)


@app.get("/film-status/{film_id}", response_model=FilmStatusResponse)
def film_status(film_id: str):
    with _films_lock:
        data = _films.get(film_id)
    if not data:
        raise HTTPException(status_code=404, detail="Unknown film_id")
    return FilmStatusResponse(**data)


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


@app.get("/film/{film_id}")
def get_film(film_id: str):
    if not film_id.replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid film_id")
    mp4 = FILM_DIR / f"{film_id}.mp4"
    if not mp4.exists():
        raise HTTPException(status_code=404, detail="Film not found")
    return FileResponse(
        str(mp4), media_type="video/mp4", filename=f"{film_id}.mp4",
        headers={"Cache-Control": "public, max-age=86400"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
