# tests/

Production-readiness test suite for the 3D Video Gen mapper / tracker /
projection stack.

## Run everything

```bash
bash tests/run_all.sh
# or, skip live-backend checks:
bash tests/run_all.sh --quick
# or, point at a local backend:
BACKEND_URL=http://localhost:7860 bash tests/run_all.sh
```

Total runtime: ~5–10 seconds. Zero external dependencies; runs on plain
Node ≥ 18.

## What gets tested

| File | What |
|---|---|
| `test_perspt.mjs` | Homography solver (`public/lib/perspt.js`): identity, round-trip, known-mapping, mat3 packing, degenerate-input fallback. |
| `test_hand_filters.mjs` | `HandGestureClassifier` (`public/hand_filters.js`): EMA, palm-size, pinch state machine + edges (`justClosed` / `justOpened` fire **once** per cycle), fist / open-palm / swipe detectors, null-input robustness. |
| `test_gaze_tracking.mjs` | `GazeTracker` (`public/gaze_tracking.js`) over MediaPipe iris landmarks 468–477: centred ratio = 0.5, extreme-corner ratios, blink detection, `<478` landmarks return null, `getPoseOffset` sign + scale. |
| `test_imports.mjs` | Every pure-ESM module under `public/` resolves under Node and exports the symbols the rest of the codebase imports. |
| `test_html_smoke.mjs` | `index.html` / `mapper.html` / `player.html` / `cam-diag.html`: title + charset present, every relative `<script>`/`<link>` resolves on disk, importmap aliases `three`, required element ids present (POV pill must have all 4 buttons, mapper toolbar must have 🎯 Calibrate), CSP / X-Frame-Options / Permissions-Policy ship in `vercel.json`. |
| `test_e2e_scan_map_project.mjs` | End-to-end **scan → map → project** flow at the data-shape level: mock 3 detected surfaces, compute per-surface homographies via PerspT, build the JSON the Mapper "Save" button would POST, run the client-side URI scheme guard (incl. 7 adversarial cases), then if the backend is reachable do a real `POST /projection-project` + `GET /projection-project/{id}` round-trip and surface a deploy-pending banner if the server-side URI guard from commit `aa50788` isn't live yet. |
| `test_backend.sh` | Live backend smoke (against `BACKEND_URL`): save → load roundtrip, `javascript:` URI rejected with 4xx, 200-char surface name rejected, non-UUID GET rejected, rate-limit fires when >20 writes/60s. |

What CANNOT be tested in pure Node (requires browser):

- WebGL render output → tested manually in the browser.
- MediaPipe inference → tested manually with `Studio → POV pill → Face/Hand/Gaze`.
- Maptastic drag-handle UI → tested manually in `Mapper → 🎯 Calibrate / M`.
- Pinch synthetic PointerEvents → tested manually with hand-pose held over webcam.

For the WebGL / inference / UI tier, the lift would be JSDOM + `@webgl/webgl`
shim + a MediaPipe stub — material work, and brittle. Cheaper to verify in
the browser after deploy.

## Test counts after the most recent run

```
PerspT:                19/19
HandGestureClassifier: 17/17
GazeTracker:           15/15
imports:               17/17
html smoke:            59/59
E2E scan-map-project:  27/27
Total:                174 assertions
```

Plus the backend smoke (variable count depending on backend availability).

## CI hook

Add to `.github/workflows/test.yml`:

```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: bash tests/run_all.sh --quick
```

The `--quick` flag is recommended for CI — live-backend smoke is for local
post-deploy verification.

## Adding new tests

1. Drop a new `test_*.mjs` (or `.sh`) file in this folder.
2. `import { suite, ok, equal, approx, report } from "./_assert.mjs"` —
   no test framework needed.
3. End the file with `report()` so `process.exitCode` is set.
4. Add a `run node tests/test_X.mjs` line to `run_all.sh`.

The `_assert.mjs` helper covers `ok`, `equal`, `approx`, `approxVec`, `throws`,
and a `suite()` group header.
