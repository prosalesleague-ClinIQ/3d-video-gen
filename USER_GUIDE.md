# 3D Video Gen — User Guide

A three-page web app for scanning a wall / projection surface, mapping
videos onto it, and playing the result back with optional head, eye and
hand tracking.

- **Studio** (`/`) — the creative workspace. Pop-out 3D parallax driven by
  face, hand, or eye tracking; stereo output for Epson 3D projectors.
- **Mapper** (`/mapper.html`) — point a camera at a wall, AI finds
  rectangles, click each to assign a video.
- **Player** (`/player.html`) — playback view for a finished mapping with
  14 style presets.

---

## Quick start (60 seconds)

1. Open `https://3d-video-gen.vercel.app/mapper.html`.
2. Click **🎥 Camera** in the toolbar. (Browser asks for webcam permission;
   choose "Always allow on this site".)
3. Point the camera at a flat wall or framed picture.
4. Click **🤖 Scan** — rectangles appear over detected surfaces.
5. Click any surface → the video picker opens → choose a preset, paste a
   URL, or upload a file.
6. Click **Save** in the top-right. You get a project ID.
7. Open `?id=<that-id>` on `player.html` to play the mapping in any style.

---

## The four POV modes (Studio only)

The Studio toolbar has a **POV** pill with four options. They all drive the
same off-axis frustum projection — the difference is which signal moves the
camera.

| Mode | What drives the camera | Best for |
|---|---|---|
| 📷 **Off** | A mouse-parallax fake | Browsing without a webcam |
| 👤 **Face** | Head pose from MediaPipe FaceLandmarker | Standard "look-around" 3D |
| ✋ **Hand** | Index-finger tip + pinch from HandLandmarker | Hands-free / "Minority Report" UI |
| 👁 **Gaze** | Head pose + iris-direction blend | Strongest "look around the corner" illusion, esp. with Epson stereo glasses |

All three trackers share one webcam stream — turning on Gaze does NOT
prompt for camera access a second time if Face was already on.

**Tracker status** (top-right): a small pill with `👤 ✋ 👁` icons + live
FPS. Icons light up cyan when that tracker is running.

---

## Mapper workflow in detail

The mapper toolbar is grouped into 7 sections:

### Capture
- **🎥 Camera** — start the webcam.
- **👁 Preview** — toggle a 200×150 thumbnail of the camera feed in the corner.

### Detect
- **🤖 Scan** — find rectangles (good for windows, framed art, monitors).
- **🔬 Detail** — hierarchical sub-rect scan for more granular surfaces.
- **🎨 Light/Dark** — luminance-based detection (best for paintings or
  surfaces with internal contrast rather than hard edges).

### Surfaces
- **✏️ Draw** — manual polygon mode. 3+ clicks, double-click closes.
- **⎘ Dup** — duplicate the selected surface (useful for repeating patterns).
- **🗑 Del** — delete selected. (Or press `Del`.)
- **⌫ Clear** — remove all surfaces.
- **↺ Reset** — reset the 4-corner Maptastic calibration to identity.

### Assign
- **🎲 Random** — random video preset on every empty surface.
- **🎬 Pick** — click any surface in the viewport to open the picker.
- **🌐 All scene** — every surface plays the live 3D scene render.
- **📷 All cam** — every surface mirrors the webcam.
- **✕ All empty** — clear every surface.

### View
- **⊞ Grid** — toggle reference grid (or press `G`).
- **📊 HUD** — toggle HUD + surface list.
- **🎯 Calibrate** — enter Maptastic 4-corner calibration mode (or press `M`).
- **⛶ Full** — fullscreen (or press `F`).

### Playback
- **▶ Play** / **⏸ Pause** — all surfaces.
- **🔇 Mute** — toggle audio on every surface.
- **🔁 Loop** — videos loop by default; toggle off to play once.
- **⟲ Sync** — restart all videos from t=0.

### Output
- **📸 Snap** — PNG snapshot of the canvas.
- **🔴 Rec** — start recording WebM (click again to stop). Audio is NOT
  captured — only the visual canvas.
- **📄 JSON** — download the raw project JSON.

---

## 🎯 Maptastic calibration

If your projector isn't perfectly perpendicular to the wall, the mapped
video will be skewed. Press **M** or click the 🎯 Calibrate toolbar button
to enter calibration mode:

- 4 corner handles appear at the corners of the canvas.
- Drag each handle to where you want that corner of the projection to land.
- The CSS transform of the canvas updates in real time.
- Press **M** again to exit (or click the button).

The calibration is auto-saved to localStorage and **automatically applied
on the Player page** — so once you've aligned the projector once, every
project on this device plays correctly.

To start fresh: in DevTools, run `localStorage.removeItem("maptastic.layers")`
or use the **↺ Reset** toolbar button.

---

## Hand-tracking gestures (Mapper)

When POV=hand on Studio OR when you toggle **✋ Hand** on the Mapper
toolbar:

- **Index finger** → drives an on-screen cursor dot.
- **Pinch** (thumb tip touches index tip) → fires a synthetic
  `pointerdown` at the cursor. Same effect as clicking with a mouse.
- **Release** → fires `pointerup`.
- **Hold pinch + move** → drag (any element on the page that listens for
  pointermove sees the events).

The pinch classifier uses palm-size normalisation + EMA smoothing +
hysteresis + a 2-frame stability gate, so it works at any hand-to-camera
distance and doesn't chatter on a half-closed pinch.

Other detected gestures (read via `window.__handTracker?.()?.getPose()`):
- `"fist"` — all 4 finger tips close to wrist
- `"palm"` — all 4 finger tips far from wrist (open hand)
- `"peace"` — index + middle up, ring + pinky down
- `"point"` — only index up
- `"pinch"` — thumb tip touches index tip

---

## Epson 3D output

The Player has a **🎥 Epson 3D preset** button that:

1. Picks Side-by-Side stereo output.
2. Goes fullscreen.
3. Sets a sensible eye-separation default (0.064m).

Then on your Epson remote:
- Press **2D/3D** → select **3D Format: Side-by-Side**.
- Pair your active shutter glasses (per projector manual).
- If eyes feel swapped, press **3D Inversion** on the remote OR press
  **F** in the app.

For the best result, also set POV → **👁 Gaze** so the disparity follows
where your eyes are looking, not just your head.

---

## Saving / loading projects

- **Save** in the Mapper → backend assigns a UUID → URL `?id=<UUID>` works
  on `player.html` for anyone with the link.
- Project store is currently public (no auth) — anyone with the ID can
  view. Don't put sensitive data in projects.
- Per-IP rate limit: 20 saves per minute. (Tunable via
  `PROJECTION_RATE_MAX` and `PROJECTION_RATE_WINDOW_SEC` env vars on the
  backend.)
- Per-surface URI is whitelisted on the server: only `http:` and `https:`
  schemes are stored. `javascript:`, `data:`, `file:`, `blob:` are
  rejected with 400. (Client also enforces this before any video element
  is touched.)
- Per-surface name + id are length-bounded (120 / 80 chars max). Saved
  names + ids are HTML-escaped before any render — `<script>` payloads
  appear as plain text, not executed.

---

## Keyboard shortcuts (Mapper)

| Key | Action |
|---|---|
| `Space` | Play / pause all |
| `D` | Detail scan |
| `L` | Light/Dark scan |
| `R` | Randomise presets |
| `M` | Toggle Maptastic calibration |
| `G` | Toggle grid |
| `F` | Fullscreen |
| `Del` | Delete selected surface |
| `Esc` | Cancel current draw / close picker |
| `1`–`8` | (Player only) Switch style preset |

---

## Troubleshooting

### Camera doesn't start

Open `/cam-diag.html`. It runs five checks and tells you exactly where the
failure is (HTTPS, permission state, device list, getUserMedia call).

If everything is green on cam-diag but the Mapper still doesn't see the
camera, your DevTools console will have a `[mapper]` log explaining why.

### "WebGL context creation failed"

Usually a stuck GPU process. Hard-refresh (Cmd-Shift-R / Ctrl-F5). If that
doesn't fix it, restart your browser. Some Linux + integrated-GPU setups
need `--enable-unsafe-webgpu` in chrome://flags.

### FPS drops with Hand + Face + Gaze all on

That's three MediaPipe inferences per frame. On a 2019-era MacBook Pro
you'll see ~30 fps. Drop to just Face (or just Hand) for ~60.

### Maptastic corners aren't where I left them

The corners persist to `localStorage["maptastic.layers"]`. Open a different
browser / profile and you'll start with identity calibration again — that's
expected. To copy calibration across machines: copy that one localStorage
key.

---

## Privacy

- The webcam stream **never leaves your device**. All MediaPipe inference
  runs in WASM in your browser.
- The 🔴 Rec button captures the canvas, NOT the webcam — no audio is
  recorded.
- Project saves go to the demo backend at
  `prosalesleague-3d-video-gen.hf.space`. They contain only the JSON shape
  of your mapping (surface polygons, video URIs, calibration matrix) — no
  webcam frames, no audio.
- `cam-diag.html` is `noindex,nofollow` and frame-busted.
- See `vercel.json` for the full set of security headers (CSP,
  X-Frame-Options, Permissions-Policy, Referrer-Policy, HSTS).

---

## For developers

See `.audit/` for the security audit, skill inventory, zip extraction
plan, and architecture notes. Tests live in `tests/`:

```bash
bash tests/run_all.sh --quick   # offline suite (~5s, 174 assertions)
bash tests/run_all.sh           # adds live-backend smoke
```

CI: `.github/workflows/test.yml` runs `--quick` on every push.
