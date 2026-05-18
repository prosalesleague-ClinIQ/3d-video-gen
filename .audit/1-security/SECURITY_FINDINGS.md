# Security Findings — 3D Video Gen

Audit scope: `public/*.html|js|css`, `demo-service/app.py`, `vercel.json`, `requirements.txt`. Live at https://3d-video-gen.vercel.app + backend https://prosalesleague-3d-video-gen.hf.space.

## EXECUTIVE SUMMARY

The app is a public, unauthenticated demo. Two clear **CRITICAL** issues dominate the risk: (1) stored XSS via the `/projection-project` save/load flow — saved JSON `surfaces[].name` and `surfaces[].id` are concatenated into `innerHTML` in three places (mapper.js, player.js, app.js), and any link of the form `player.html?id=<attacker-project>` runs arbitrary JS in the victim's origin; (2) the backend lets **any** anonymous client read/write any project by UUID, so an attacker can spray malicious projects and share `?id=` links. Several **HIGH** issues compound this: a per-surface `uri` field is unsanitized post-load and fed into `<video src>` / `TextureLoader`, the backend has `CORS allow_origins=["*"]`, and there is no `Content-Security-Policy`, `X-Frame-Options`, or `frame-ancestors`, so XSS payloads can exfiltrate, clickjack, or run unrestricted. Headers / supply-chain issues are **MEDIUM** — CDN pins are mostly tight but a few subresources are not SRI-pinned.

**Counts:** CRITICAL 2 · HIGH 6 · MEDIUM 7 · LOW 4 · INFO 3

---

## CRITICAL

| # | File:line | Why this matters | Snippet | Fix |
|---|-----------|------------------|---------|-----|
| C1 | `public/mapper.js:682-693`, `public/app.js:1728-1740`, `public/player.js:163-165` | Stored XSS. `surfaces[].name` and `.id` come from `/projection-project/{id}` and are interpolated into `innerHTML` without escaping. Any victim opening `player.html?id=<attacker>` executes JS in the app origin. | `` list.innerHTML = items.map(s => ``...``<span class="sli-name">${s.name}</span>``...``data-sid="${s.id}"`` | Use `textContent`, or sanitize via `DOMPurify`. Escape `id` for attribute use. |
| C2 | `demo-service/app.py:579-605` | Unauthenticated CRUD on projection projects. Anyone can POST a project, returns a UUID, and `GET /projection-project/{uuid}` is open. Combined with C1, attackers can spray malicious projects and share `?id=` links anywhere the app is embedded/used. No rate-limit, no owner check. | `@app.post("/projection-project")` no auth | Add a per-IP rate-limit (slowapi), a shared-secret or per-session token, and a `mode=read-only` flag on share links. |

## HIGH

| # | File:line | Why this matters | Snippet | Fix |
|---|-----------|------------------|---------|-----|
| H1 | `demo-service/app.py:85-91` | CORS `allow_origins=["*"]`. `allow_credentials=False` so it's not the credentialed-CORS footgun, but it does let arbitrary origins read every backend response (including future endpoints that might leak data). | `allow_origins=["*"]` | Pin to `https://3d-video-gen.vercel.app` + localhost. |
| H2 | `public/projection_mapping.js:979`, `:1003` | Per-surface `uri` is loaded from saved project JSON and fed into `<video src>` and `TextureLoader().loadAsync(...)` without scheme validation. Backend only validates `content.uri`, not `surfaces[].uri`. Allows arbitrary remote fetches, fingerprinting, SSRF-as-the-victim, possible mixed-content / referer leakage. | `video.src = actualUri;` | Run `_validate_projection_content`-equivalent over every `surfaces[].uri` on save AND on the client before `assignToSurface`. |
| H3 | `demo-service/app.py:555-558` | `ProjectionProject.surfaces: list[dict]` is an unvalidated dict with `max_length=100`. No per-item schema, no length bounds on `name`/`id`. Lets attackers stuff JS payloads, MBs of garbage, or polymorphic keys. | `surfaces: list[dict] = Field(..., max_length=100)` | Add a `SurfaceItem` Pydantic model (id, name length-bounded, polygon shape check, uri scheme-whitelist). |
| H4 | `public/index.html`, `public/mapper.html`, `public/player.html` (all) | No `Content-Security-Policy`. Combined with C1 the page allows inline scripts, eval, arbitrary external script loads. A CSP would have neutered XSS. | (no header) | Add `<meta http-equiv="Content-Security-Policy">` and ideally Vercel `headers` rules. See `HEADERS_GAP.md`. |
| H5 | All HTML | No `X-Frame-Options` / `frame-ancestors`. App is fully frameable, so any XSS / UI-redress attack lifts to clickjacking the webcam-grant or save buttons. | (none) | Set `frame-ancestors 'none'` in CSP. |
| H6 | `public/cam-diag.html:46` | Hardcoded link to `chrome://settings/content/camera`. Not a vuln by itself, but the page is reachable in prod and provides a one-click webcam test (`getUserMedia({video:true})`) on the live origin without nav-controls. Attackers can deep-link to it inside an iframe (no X-Frame-Options) to trick users into granting camera. | `<a href="chrome://settings...">` | Remove `cam-diag.html` from prod, or add `frame-ancestors 'none'` + `<noindex>`. |

## MEDIUM

| # | File:line | Why this matters | Snippet | Fix |
|---|-----------|------------------|---------|-----|
| M1 | `demo-service/app.py:566-576` | `content.uri` whitelist allows `blob:`. `blob:` is fine when the blob URL is created in-document; from a saved project, `blob:` will resolve to nothing on the loader — but the whitelist accepts it. Low impact, but unnecessary. | `_ALLOWED_URI_SCHEMES = {"http", "https", "blob", ""}` | Drop `blob:` (always client-side only) and `""` (empty scheme = relative URL → unexpected). |
| M2 | `demo-service/app.py:359-413` | `/image-to-3d` accepts `image_b64` of arbitrary length. No size cap — a 100 MB base64 string is decoded into memory (`base64.b64decode`). Trivial DoS. | `image_b64 = payload.get("image_b64")` | `Field(..., max_length=10_000_000)` or check string length before decode. |
| M3 | `demo-service/app.py:160` | `/compile-film` accepts up to 20 `render_ids` but no auth — anyone can drive expensive ffmpeg work on the HF Space. | `render_ids: list[str] = Field(..., min_length=1, max_length=20)` | Rate-limit, add a token, or remove from public surface. |
| M4 | `demo-service/app.py:99, 115, 125` | DirectRequest / SceneRequest / GenerateRequest have `prompt` length-capped at 500 chars BUT `direction` is an unrestricted dict. The `direction` dict flows into `_effective_prompt` which `str()`-casts subfields into the Blender scene prompt — large or weird input is gracefully degraded but unbounded memory growth is possible. | `direction: dict \| None = None` | Wrap `direction` in a strict Pydantic model. |
| M5 | `public/projection_mapping.js:101` | `await import(url)` of `three-projected-material` from jsdelivr/unpkg. CDN fetch is unpinned by SRI. A compromise of either CDN → arbitrary JS in app origin. | `const mod = await import(url);` | Self-host or set up an importmap with a hash + integrity attribute (importmaps don't natively support SRI; switch to a `<script>` tag with `integrity=`). |
| M6 | `public/mapper.js:778`, `public/app.js:~ project name prompt` | `name` is passed to backend with `slice(0, 80)` but no client-side sanitization. Backend uses it as `ProjectionProject.name` and stores it. If anywhere the `name` is rendered into HTML in future, it'd be another XSS vector. | `const name = (prompt(...) || "untitled").slice(0, 80);` | Strip `<`/`>`/control chars before sending. |
| M7 | `demo-service/app.py:513-538` | `/video/{render_id}` and `/film/{film_id}` use `render_id.replace("-", "").isalnum()` to validate. Acceptable for hex UUIDs, but a render_id like `ABC..` could in theory match files outside the intended dir if `VIDEO_DIR` ever lived next to other content. Files are streamed via `FileResponse(str(mp4_path))`. Defense in depth: also resolve and check is_relative_to. | `if not render_id.replace("-", "").isalnum():` | Add `(VIDEO_DIR / f"{render_id}.mp4").resolve().is_relative_to(VIDEO_DIR.resolve())`. |

## LOW

| # | File:line | Why this matters | Snippet | Fix |
|---|-----------|------------------|---------|-----|
| L1 | `public/mapper.js:429-438` | `MediaRecorder` records `canvas.captureStream(30)` — the canvas only contains scene/webcam visuals, NOT mic audio (no `audio` track is added to the canvas stream). Audio leak risk: NONE in current code. Worth a comment noting "no audio captured" so future devs don't add it. | `_recorder = new MediaRecorder(stream, ...);` | Add comment + an explicit assertion that `stream.getAudioTracks().length === 0`. |
| L2 | `public/webcam.js:33` | `getUserMedia` is called inside `_initPromise` which fires from a non-gesture context (page load of `mapper.html`). Browsers usually still prompt — but the gesture requirement is shaky. Privacy-conscious: only call after explicit user click. | `_stream = await navigator.mediaDevices.getUserMedia(...)` | Defer until a user gesture (click on the Camera step button), which Mapper already largely does via `bootCameraStep` chain. |
| L3 | `demo-service/app.py:50-51` | TRELLIS bearer token is loaded from env and forwarded server-side. Token never reaches the client. OK as-is, but log line in `_run_render_with_graph` could include arguments — confirm no token leakage in logs. | `HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()` | None — informational. |
| L4 | `public/config.js:3` | Backend URL is publicly known; not a secret. INFO-only. | `window.__BACKEND_URL__ = "https://prosalesleague-3d-video-gen.hf.space";` | None. |

## INFO

| # | File:line | Note |
|---|-----------|------|
| I1 | git history scan | `git log -p --all -S "ANTHROPIC" -S "sk_" -S "hf_" -S "Bearer"` — no API keys, tokens, or credentials surfaced in history. `.env.example` ships sample/dev passwords (`studio`, `minio123`) only. |
| I2 | `public/cam-diag.html:6`, `public/mapper.html:9` | Permissions-Policy is set via `<meta>` but only on Mapper + cam-diag, not on `index.html` / `player.html`. Browsers ignore `Permissions-Policy` from `<meta>` for cross-origin frames; ship it as a real header via Vercel. |
| I3 | `public/projection_mapping.js:60` | OpenCV is loaded from `docs.opencv.org` — official source, not pinned by hash. Acceptable, but consider SRI-pinning. |
