# GOLD Extraction Plan

Four zips contain code that is browser-runnable or trivially portable. Each recipe gives the exact file, port target, and integration point.

---

## 1. `maptasticjs-master.zip` → projection-mapping calibration UI

**Extract**: `maptasticjs-master/src/maptastic.js` (744 LOC) and `maptasticjs-master/lib/numeric_solve.min.js` (~90 LOC of `numeric.js` SVD/LU solver).

**Drop into**: `public/lib/maptastic.js` + `public/lib/numeric_solve.min.js`.

**Integration**: Replace the bespoke 4-corner drag logic in `/Users/christomac/Projects/3d video Gen/public/mapper.js` (and `mapper.html`). Maptastic takes a DOM-element id list, draws drag-handles, persists the per-corner matrix to localStorage, and emits an `onchange(layers)` callback containing the 3×3 homography. Wire that callback to: (a) update the CSS `matrix3d(...)` on the mapped video layer in `mapper.html`, and (b) push the same matrix into the `projection_mapping.js` Three.js shader as a uniform so the WebGL render and the DOM preview stay aligned. Press 'M' or query-string `?config` to enter calibration mode — already supported. ~80 LOC of glue to write; ~600 LOC of bespoke corner-drag deleted from `mapper.js`.

---

## 2. `p5.mapper-main.zip` → homography math core

**Extract**: `p5.mapper-main/src/perspective/PerspT.js` (151 LOC) and `p5.mapper-main/src/perspective/numeric.js` (249 LOC — only the solve helpers, ~80 LOC if trimmed).

**Drop into**: `public/lib/perspt.js`.

**Integration**: `PerspT(srcPts, dstPts)` returns `.transform(x,y)` and `.coeffs` (the 8 homography coefficients). Use this inside `/Users/christomac/Projects/3d video Gen/public/projection_mapping.js` for the AI-surface-detection → mapped-quad pipeline. Currently surfaces detected by MediaPipe are sent through ad-hoc matrix math; replacing it with `PerspT` gives an inverse-mapping function we can sample inside a fragment shader (pass `coeffs` as a `uniform vec3[3]`) for sub-pixel-correct projection onto detected planes. Also unlocks per-surface independent warps for the multi-surface mapping feature. Works standalone — no p5 dependency despite the package name (verified by reading source: `import numeric from "./numeric"` is the only dep).

---

## 3. `yoha-main.zip` → hand-tracking filter + gesture helpers

**Extract** (all under `yoha-main/src/util/` and `yoha-main/src/core/post_model/`):
- `ema.ts` (21 LOC) — exponential moving average smoother
- `hand_helper.ts` (~30 LOC) — `ComputeApproximatePalmSizePx` (distance between 21 landmark indices)
- `math_helper.ts` (~150 of 364 LOC are reusable: `MakeCoordsAbsolute`, `ComputeDistanceBetweenVectors`, `RotateCoordsAround`)
- `post_model.ts` (214 LOC) — pinch / fist state classifier built on top of raw landmark coords

**Drop into**: `public/hand_filters.js` (already exists in spirit alongside `onee_filter.js` — extend it).

**Integration**: Our `/Users/christomac/Projects/3d video Gen/public/hand_tracking.js` already uses MediaPipe HandLandmarker + a 1€ filter (`onee_filter.js`). yoha's `ema.ts` is dirt-simple; its real value is `post_model.ts`'s **temporal pinch-detector** which combines fingertip distance, palm-size normalisation, and a debounce — exactly what we'd need to fire reliable "grab this corner" events in projection-mapping mode. Port the `PinchClassifier` class (~80 LOC) verbatim by aliasing yoha's 21-point indices to MediaPipe's (same MediaPipe-hand topology). Replace the threshold-only pinch check currently in `hand_tracking.js`. ~3 hours of porting.

---

## 4. `GazeTracking-master.zip` → gaze direction over MediaPipe iris

**Extract**: `gaze_tracking/gaze_tracking.py` (133 LOC), `eye.py` (121 LOC), `pupil.py` (54 LOC).

**Drop into**: `public/gaze_tracking.js` (new file, ~150 LOC after JS port).

**Integration**: Currently `/Users/christomac/Projects/3d video Gen/public/head_tracking.js` derives POV-parallax from head pose only. Adding gaze (where the eyeballs are pointed within the head) significantly improves the "look around the corner" illusion. The Python code: (a) isolates eye ROI from 68 dlib landmarks — **replace with MediaPipe FaceLandmarker iris points 468–477 we already get**; (b) binarises + finds contour centroid for pupil position — port as a 10-line canvas2d filter, OR skip entirely because MediaPipe gives us iris centres directly; (c) computes `horizontal_ratio` and `vertical_ratio` as pupil-position within the eye-box. The ratio math is ~30 LOC and is the actual value. Feed the resulting `(gazeX, gazeY)` into the parallax camera offset in `head_tracking.js` alongside the existing head-pose vector. Bonus: also useful for stereo / Epson glasses output to bias the disparity toward the convergence point.

---

## Build order

1. **maptasticjs** first — visible UX win, mostly delete-and-paste.
2. **p5.mapper PerspT** — unlocks correct multi-surface warps in WebGL.
3. **yoha PinchClassifier** — reliable gesture for the new mapper UI.
4. **Gaze** — last, layered on existing head-tracking parallax.

Total port budget: ~5–8 hours of focused work for all four; net new code ~800 LOC, deletes ~600 LOC of bespoke math/UI.
