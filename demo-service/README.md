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
