# CDN Pin Report — 3D Video Gen

All third-party URLs found in shipping HTML/JS, with pinning and recommendation. None ship with SRI `integrity=` hashes.

| URL | Used in | Version pin | Recommendation |
|-----|--------|-------------|----------------|
| `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js` | `index.html:19`, `mapper.html:17`, `player.html:14` | EXACT `@0.170.0` | OK — exact version. Consider self-hosting for SRI + offline. |
| `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.webgpu.js` | `index.html:20`, `mapper.html:19`, `player.html:16` | EXACT `@0.170.0` | OK |
| `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.tsl.js` | `index.html:21` | EXACT `@0.170.0` | OK |
| `https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/` | `index.html:22`, `mapper.html:18`, `player.html:15` | EXACT `@0.170.0` (importmap prefix) | OK — addons resolve from same version. |
| `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs` | `head_tracking.js:11`, `hand_tracking.js:19` | EXACT `@0.10.34` | OK |
| `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm` | `head_tracking.js:12`, `hand_tracking.js:20` | EXACT `@0.10.34` | OK |
| `https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js` | `splat_viewer.js:5` | EXACT `@0.4.7` | OK |
| `https://cdn.jsdelivr.net/npm/three-projected-material@2.2.2/build/ProjectedMaterial.module.js` | `projection_mapping.js:63` | EXACT `@2.2.2` | OK |
| `https://unpkg.com/three-projected-material@2.2.2/build/ProjectedMaterial.module.js` | `projection_mapping.js:64` | EXACT `@2.2.2` | OK — fallback only. **Two trust domains** for the same module increases blast radius; consider dropping the unpkg fallback OR self-hosting both. |
| `https://docs.opencv.org/4.10.0/opencv.js` | `projection_mapping.js:60` | EXACT `4.10.0` path | OK — but `docs.opencv.org` is the OpenCV project's docs CDN, not the most hardened distribution channel. Consider self-hosting (10 MB WASM) since it's already on first-paint deferred. |
| `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | `head_tracking.js:13` | path-version `1` (Google's pinned bucket) | OK — Google-hosted model. |
| `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/*_1k.hdr` (×4) | `app.js:37-42` | path-named files | OK — CC0 assets. |
| `https://res.cloudinary.com/demo/video/upload/*.mp4` (×6 presets) | `projection_mapping.js:28-33`, `mapper.html:25-29` | named files, no version | OK — Cloudinary demo account is public + stable. INFO: traffic is observable by Cloudinary, but no PII. |

## Summary

- **Total third-party endpoints:** 13 distinct hostnames/paths.
- **Pinned by version:** 11/13. Two (Cloudinary, GCS model) are pinned by file path.
- **SRI integrity hashes:** 0/13. **Recommend** moving the critical importmap entries to self-hosted with SRI (importmap does not support SRI yet; use `<link rel="modulepreload" integrity="sha384-...">` for hot paths or vendor into `/public/vendor/`).
- **Multi-source fallback:** `three-projected-material` loads from jsdelivr OR unpkg; 2x blast radius. Pick one or self-host.

## Top recommendations

1. Self-host `three@0.170.0` + addons (~1.5 MB) under `/public/vendor/three/` and import from there. Eliminates jsdelivr trust on the critical path.
2. Self-host `opencv.js` 4.10.0 (~10 MB) under `/public/vendor/opencv/`. Removes `docs.opencv.org` from the supply chain.
3. Drop the unpkg fallback for `three-projected-material` once self-hosted.
4. Add a `Subresource Integrity` policy for any remaining `<script src>` (none in current HTML — they're all module imports via importmap).
