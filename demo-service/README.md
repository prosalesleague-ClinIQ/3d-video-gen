---
title: 3D Video Gen
emoji: 🎬
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Prompt → 3D Blender render → MP4
---

# 3D Video Gen — Live Demo

Enter a text prompt, get back a short 3D-rendered video.

- Scene graph generated deterministically (or via Claude API if `ANTHROPIC_API_KEY` is set)
- Rendered with Blender 3.6 Cycles on CPU
- Stitched to MP4 with ffmpeg
- 48 frames @ 24fps = 2-second clip at 512×512

**Endpoints:**
- `GET /` — health check
- `POST /generate` — body: `{"prompt": "..."}`, returns `{"video_url": "...", "scene_graph": {...}, "render_ms": ...}`
- `GET /video/{id}` — streams the MP4

This is the public demo of the distributed [3d-video-gen](https://github.com/prosalesleague-ClinIQ/3d-video-gen) pipeline.

## Environment variables

- `BLENDER_BIN` — path to Blender executable (default: `/usr/local/bin/blender`)
- `HDRI_DIR` — directory holding `{studio,sunset,night,forest}.hdr` (default: `/app/assets/hdri`). Run `assets/hdri/fetch.sh` before `docker build` to populate.
- `TRELLIS_SPACE_URL` — optional Gradio predict URL for a TRELLIS image→3D HF Space. When set, `POST /image-to-3d` proxies to it. Falls back to deterministic scene graph otherwise.
- `HF_TOKEN` — optional Hugging Face access token for gated TRELLIS spaces.

## /image-to-3d usage

```bash
curl -X POST https://<host>/image-to-3d \
  -H 'Content-Type: application/json' \
  -d '{"image_b64":"<base64 png/jpg>","format":"ply"}'
# → {"asset_url": "...", "format": "ply", "source": "trellis", "ms": 1234}
# or on fallback: {"scene_graph": {...}, "source": "fallback-scene-graph", "ms": 45}
```
