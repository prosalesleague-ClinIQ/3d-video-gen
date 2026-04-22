# 3D Video Gen

**Live demo:** https://3d-video-gen.vercel.app

Enter a text prompt → get back a 3D-rendered MP4 video.

## Architecture

Two deployed pieces:

1. **Frontend** — static HTML + JS on [Vercel](https://3d-video-gen.vercel.app)
2. **Backend** — Dockerized FastAPI + Blender 3.6 + ffmpeg on [Hugging Face Spaces](https://huggingface.co/spaces/prosalesleague/3d-video-gen)

```
Browser ─POST /generate {prompt}─▶ HF Space (Docker)
                                     ├─ scene_builder.py  (Claude API optional, deterministic fallback)
                                     ├─ blender_entrypoint.py  (bpy scene → 48 CPU frames)
                                     └─ video_compose.py  (ffmpeg → MP4)
                                   ─▶ returns {video_url, scene_graph, render_ms}
```

## Render specs (live demo)

- 512×512, 48 frames @ 24 fps = 2-second MP4
- Blender Cycles, 16 samples, CPU (HF free tier)
- Typical render time: ~4–5 minutes (cold) / ~2–3 minutes (warm)
- Supports primitives: cube, sphere, cylinder, cone, plane, torus, monkey
- Material palette picked from color keywords in prompt

## Repo structure

```
demo-service/         # Live single-container backend (deployed to HF Space)
public/               # Static frontend (deployed to Vercel)
bootstrap/            # Local infra bootstrap (seed DB, Kafka topics, MinIO bucket)
helm/studio/          # Production distributed deployment (Kubernetes umbrella chart)
services/             # Individual microservices (scene, controller, reward, video-assembler)
workers/blender-worker/  # Distributed Blender worker
shared/ db/ kafka_client/  # Shared libraries
tests/e2e/            # End-to-end pipeline test (pytest)
scripts/              # Utility scripts
docker-compose.yml    # Local development stack
Makefile              # up, down, bootstrap, smoke, test-e2e
```

## Run locally (full distributed stack)

```bash
cp .env.example .env
# Optional: add ANTHROPIC_API_KEY for LLM scene generation
make up          # postgres, kafka, minio, all services
make bootstrap   # create DB tables, Kafka topics, MinIO bucket
make smoke       # send test prompt
make test-e2e    # run pytest E2E test
```

## Re-deploy backend to HF

```bash
export HF_TOKEN=hf_xxx
python3 -c "
from huggingface_hub import upload_folder
upload_folder(
    folder_path='demo-service',
    repo_id='prosalesleague/3d-video-gen',
    repo_type='space',
)"
```

HF auto-rebuilds the Docker image on push (~60–90 seconds).

## Re-deploy frontend to Vercel

```bash
vercel --prod
```

## License

MIT
