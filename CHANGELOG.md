# Changelog

All notable changes to 3D Video Gen.

Format: human-readable summary per commit. Versioning is intentionally
informal — there's one branch (`main`) and continuous deployment.

---

## [1.0.0] — 2026-05-17 — Production-ready release

This release ships the AI projection mapper with head, eye and hand
tracking, the security audit, a full test suite and CI.

### Added — features

- **👁 Gaze POV mode** — fourth POV option on Studio. MediaPipe
  FaceLandmarker's iris landmarks (468–477) drive a 1€-smoothed
  horizontal + vertical gaze ratio that composes with head pose for the
  strongest "look around the corner" illusion, especially with the Epson
  stereo output. Reuses the same webcam stream + inference as Face mode.
- **🎯 Maptastic 4-corner projection calibration** in the Mapper.
  Press `M` or click the toolbar button. Drag the 4 corner handles to
  align the projection to the physical surface. Auto-saves to
  `localStorage["maptastic.layers"]` and applies live across tabs to the
  Player.
- **Tracker-status pill** in the Studio header. Live FPS (EMA-smoothed)
  + 👤 ✋ 👁 icons that light up cyan when their tracker is running.
- **Robust pinch-edge events** — palm-size-normalised pinch distance,
  EMA-smoothed, hysteresis-gated, 2-frame stability gate. Surfaces as a
  one-shot `pose.pinchEdge ∈ {"down","up",null}` field. Far fewer
  mis-fires than the previous threshold-only detection.
- **GitHub Actions CI** (`.github/workflows/test.yml`) — runs
  `tests/run_all.sh --quick` on every push + PR.
- **`USER_GUIDE.md`** — 12-section production usage guide.

### Added — code (libraries)

- `public/lib/perspt.js` — 4-corner homography solver. Inlines the four
  numeric.js helpers it actually uses. Pure JS, zero deps, browser +
  Node compatible. Exposes `.transform()`, `.transformInverse()`,
  `.toMat3()`, `.toMat3Inverse()` for GLSL uniforms and matrix3d CSS.
  (Ported from p5.mapper, MIT.)
- `public/lib/maptastic.js` — drag-handle projection calibration UI.
  Vendored from glowbox/maptasticjs (MIT) and wrapped as ES module.
- `public/hand_filters.js` — `HandGestureClassifier` + `EMA` +
  `computeApproximatePalmSize`. Pinch / fist / open-palm / swipe
  detectors on MediaPipe's 21-point hand topology.
- `public/gaze_tracking.js` — `GazeTracker` over MediaPipe iris
  landmarks. Outputs horizontalRatio, verticalRatio, blinkRatio,
  gazeDirection, and a parallax-compatible `getPoseOffset()`.
- `public/calibration.js` — shared projector-alignment helper. Reads
  Maptastic's localStorage state and applies the matrix3d CSS transform
  to any element. Powers the Mapper-to-Player live calibration carry.

### Added — security

- **Content-Security-Policy** in `vercel.json` for all pages.
  - `frame-ancestors 'none'` (no embedding)
  - `script-src 'self' 'wasm-unsafe-eval' + jsdelivr + opencv + unpkg`
  - `connect-src` locked to known origins
  - `worker-src 'self' blob:`
- **X-Frame-Options: DENY**, **Strict-Transport-Security**,
  **Permissions-Policy** (`camera=(self)`, mic/geo/payment/usb/sensors
  off), **Referrer-Policy: strict-origin-when-cross-origin**,
  **X-Content-Type-Options: nosniff**.
- **Per-IP sliding-window rate-limit** on `POST /projection-project`
  (20 writes / 60 s, env-tunable via `PROJECTION_RATE_MAX` and
  `PROJECTION_RATE_WINDOW_SEC`).
- **Strict `SurfaceItem` Pydantic schema** — bounds `id` (≤ 80 chars),
  `name` (≤ 120 chars), `uri` (≤ 2048 chars + http(s)-only scheme),
  and rejects polymorphic dict input.
- **CORS allowlist** — production + localhost; env-overridable via
  `CORS_ORIGINS`.
- **`cam-diag.html` hardened** — `noindex,nofollow` meta + JS frame-buster
  that redirects out of any iframe and refuses to render inside
  cross-origin embeds.

### Fixed — security (CRITICAL)

- **Stored XSS in `surfaces[].name` / `.id`** that flowed from
  `/projection-project/{id}` into `innerHTML` at three sinks
  (`mapper.js:687`, `player.js:163`, `app.js:1728`). Each sink now
  escapes via an inline helper before any HTML interpolation. Any
  `player.html?id=<attacker-uuid>` link is now safe — payloads render
  as plain text.

### Added — tests

- **8 suites, 193 assertions, ALL PASS** in `tests/run_all.sh --quick`
  (~5 seconds, zero deps).
- `test_perspt.mjs` — 19/19 — identity, round-trip, known mapping,
  mat3 packing, degenerate-input fallback.
- `test_hand_filters.mjs` — 17/17 — EMA, palm size, pinch state machine,
  edges fire once per cycle, fist/palm/swipe, null robustness.
- `test_gaze_tracking.mjs` — 15/15 — centred ratios, extreme corners,
  blink detection, refineLandmarks guard, pose offset sign/scale.
- `test_calibration.mjs` — 19/19 — localStorage load/apply/clear,
  cross-tab storage events, subscribe/unsubscribe.
- `test_imports.mjs` — 17/17 — every pure-ESM module resolves + exports
  expected symbols.
- `test_html_smoke.mjs` — 66/66 — all `<script>` / `<link>` refs resolve,
  importmap aliases `three`, required element ids present, security
  headers ship in `vercel.json`, tracker-status pill markup correct,
  cam-diag hardened.
- `test_e2e_scan_map_project.mjs` — 27/27 — full scan → map → save flow
  with 7 adversarial URI cases + live backend round-trip + deploy-status
  banner.
- `test_backend.sh` — live HF Space smoke (URI guard, schema limits,
  rate limit). Correctly flags deploy gap when backend is behind.

### Added — documentation + audit

- `USER_GUIDE.md` — production usage guide
- `CHANGELOG.md` — this file
- `tests/README.md` — test suite reference
- `.audit/EXECUTIVE_SUMMARY.md` — full audit headline
- `.audit/ACTION_PLAN.md` — prioritized punch list
- `.audit/SUPABASE_KEY_ROTATION.md` — urgent: rotate leaked Supabase
  service_role JWT found in two sibling-project `env.local` files
- `.audit/1-security/` — 4 reports (findings, threat model, CDN pinning,
  headers gap)
- `.audit/2-skills/` — 268 skill inventory + 30 duplicate clusters
- `.audit/3-extraction/` — 33-zip triage with GOLD picks
- `.audit/0-inventory/` — sibling-project survey + secret-leak findings

### Operational

- `package.json` — `npm test`, `npm run test:full`, `npm run deploy`
- `scripts/deploy.sh` — front + backend deploy + verification, one
  command. Run-time precondition: rotate the Supabase service_role key.
- Project root is now clean: 33 source zips moved to
  `.audit/raw/source-zips/` (gitignored).

### Code stats

- ~9,300 LOC across `public/`, `demo-service/app.py`, and `tests/`
- 4 new browser libraries (Maptastic, PerspT, hand_filters, gaze)
- ~450 LOC ported in from upstream libs
- ~600 LOC of bespoke math/UI retired
- 0 new browser dependencies (everything stays under MediaPipe + three.js)
