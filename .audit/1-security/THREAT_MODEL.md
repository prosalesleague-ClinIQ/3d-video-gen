# Threat Model — 3D Video Gen (STRIDE)

Public, unauthenticated demo. Front-end on Vercel; FastAPI backend on Hugging Face Space. Webcam + mic capability on the client. In-memory project store on the backend (UUID-addressed).

## Actors / Assets

- **Anonymous web visitor** — main user.
- **Malicious link author** — can craft `?id=<their-project>` URLs and post them anywhere.
- **Network-adjacent attacker** — can MITM if the user is on hostile Wi-Fi (TLS terminates the obvious vector — HSTS not set, see below).
- **CDN compromise actor** — supply-chain on jsdelivr/unpkg/docs.opencv.org/Cloudinary.
- **Assets at risk:** the user's webcam stream (live), the user's Cloudinary preset video traffic (low value), the integrity of the rendered scene/film, the backend's CPU/GPU minutes on HF Space, the user's browser session in the app origin.

## STRIDE Table

| Actor | Asset | Threat | Existing mitigation | Residual risk |
|---|---|---|---|---|
| Anon visitor | Webcam stream | **Information disclosure** — page calls `getUserMedia` automatically on Mapper load (mapper.js:99-186) | User must click "Allow" in browser prompt; permission can be revoked; shared `webcam.js` handles a single stream | LOW — browser-mediated consent |
| Anon visitor | App origin DOM | **Tampering / Elevation** via XSS through saved project (`surfaces[].name` flows to `innerHTML` in mapper.js:687, player.js:163, app.js:1736) | None — no escaping, no DOMPurify, no CSP | **CRITICAL** |
| Malicious link author | Victim's browser | **Tampering** — crafts `?id=<malicious-project>`, sends to victim; load on player.html runs script in `3d-video-gen.vercel.app` origin → can read victim webcam (if granted), steal localStorage (`studio_storyboard_v1`), call backend on victim's behalf | None | **CRITICAL** |
| Malicious link author | Backend store | **Tampering** — Saves 500 projects to fill `_PROJECTS_MAX` and trigger FIFO eviction churn. Bounded but trivially spamable. | `_PROJECTS_MAX = 500` (app.py:77) + FIFO eviction (app.py:584-590) | LOW — DoS-resistant but enables spam |
| Anon visitor | Backend resources | **DoS** — `/image-to-3d` accepts unbounded base64 (app.py:368) | None | MEDIUM — single-request memory exhaustion |
| Anon visitor | Backend resources | **DoS** — `/generate`, `/compile-film` spawn Blender / ffmpeg jobs. No auth, no rate-limit. | RENDER_TIMEOUT=600 (app.py:64), max 20 clips per film | MEDIUM — cost / DOS on HF Space |
| Network-adjacent attacker | TLS connection | **Spoofing** — both Vercel + HF Space serve over TLS. No HSTS preload, no `Strict-Transport-Security` header set. | TLS termination at hosting layer; modern browsers default-secure | LOW |
| CDN compromise actor | Loaded JS | **Tampering / Elevation** — compromising jsdelivr/unpkg/docs.opencv.org delivers arbitrary JS to every user | three@0.170.0 is **pinned by version**, but no SRI integrity hashes; `three-projected-material` falls back to unpkg if jsdelivr fails — wider blast radius | MEDIUM |
| Anon visitor | Other origins | **SSRF via /projection-project** — content.uri is whitelisted to http/https/blob/empty (app.py:552), but `surfaces[].uri` is **not** validated; victim's browser fetches arbitrary URLs as `<video src>` or `TextureLoader` | Backend whitelist for `content.uri` only; `surfaces[].uri` is freeform | MEDIUM — limited because fetches happen in victim's browser, not backend, but useful for phishing/fingerprinting |
| Malicious link author | UI / clickjacking | **Repudiation / Tampering** — no `X-Frame-Options` / `frame-ancestors`. Attacker frames `mapper.html`, overlays UI, tricks user into clicking "Allow camera" or "Save" | None | MEDIUM |
| Anon visitor | localStorage `studio_storyboard_v1` | **Information disclosure** — accessible to any XSS in app origin | None | Inherits from C1/C2 |
| Backend operator | TRELLIS / HF_TOKEN | **Information disclosure** — token kept server-side, only forwarded as `Authorization` header from FastAPI to TRELLIS (app.py:378-383); never echoed to client | Env-var only; not logged in inspected code paths | LOW |

## Trust boundaries

1. Browser ↔ Vercel static — TLS, no auth.
2. Browser ↔ HF Space `prosalesleague-3d-video-gen.hf.space` — TLS, CORS `*`, no auth.
3. HF Space ↔ TRELLIS HF Space — TLS, Bearer token via env, server-to-server.
4. HF Space ↔ local Blender subprocess — local pipe, JSON scene graph file on disk (`/tmp/frames/{render_id}.json`). The scene graph is built from the user prompt by `build_scene_graph` — confirm that no prompt content is executed as Python.

## Top defenses to add (ranked by impact / effort)

1. **Escape `surfaces[].name` / `id`** on render and validate on save. Kills C1/H3.
2. **Backend CSP header** via Vercel `vercel.json` `headers` rule with `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://docs.opencv.org; frame-ancestors 'none'; object-src 'none'`.
3. **Rate-limit `/projection-project`** to ~10 saves / hour / IP (slowapi) — kills the spray attack pipeline.
4. **Pin backend CORS to known origins** (Vercel prod + localhost preview).
5. **Cap `image_b64` size** on `/image-to-3d`.
