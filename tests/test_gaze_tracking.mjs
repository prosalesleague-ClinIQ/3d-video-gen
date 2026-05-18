// GazeTracker — ratios from MediaPipe iris landmarks.
//
// We feed in a synthetic 478-landmark array where ONLY the iris + eye-corner
// + eye-lid indices are populated. Everything else can be zeros — the
// implementation only reads RIGHT.iris=468 / outer=33 / inner=133 / top=159 /
// bottom=145 and LEFT.iris=473 / outer=263 / inner=362 / top=386 / bottom=374.
//
// Tests:
//  1. Centered iris → horizontalRatio ≈ 0.5, verticalRatio ≈ 0.5.
//  2. Iris near outer corner → horizontalRatio close to 0 (looking right).
//  3. Iris near inner corner → horizontalRatio close to 1 (looking left).
//  4. Eyes squeezed shut (eyeHeight tiny) → blinkRatio large + eyesOpen=false.
//  5. Below 478 landmarks → returns null, no crash.
//  6. getPoseOffset signs match GazeTracker convention.

import { GazeTracker } from "../public/gaze_tracking.js";
import { suite, ok, equal, approx, report } from "./_assert.mjs";

// Build a synthetic landmarks array of length `n` (default 478).
function blankLandmarks(n = 478) {
  return Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
}

// Place an "eye" in the landmarks: corners + lids + iris.
// `eye` = "right" → indices 33/133/159/145/468
// `eye` = "left"  → indices 263/362/386/374/473
function placeEye(lms, eye, { outerX, innerX, topY, bottomY, irisX, irisY }) {
  const map = eye === "right"
    ? { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 }
    : { outer: 263, inner: 362, top: 386, bottom: 374, iris: 473 };
  const cy = (topY + bottomY) / 2;
  lms[map.outer] = { x: outerX, y: cy, z: 0 };
  lms[map.inner] = { x: innerX, y: cy, z: 0 };
  lms[map.top]    = { x: (outerX + innerX) / 2, y: topY, z: 0 };
  lms[map.bottom] = { x: (outerX + innerX) / 2, y: bottomY, z: 0 };
  lms[map.iris]   = { x: irisX, y: irisY, z: 0 };
}

suite("GazeTracker");

// --- 1. Centered iris ------------------------------------------------------
{
  const g = new GazeTracker({ smoothing: false });
  const lms = blankLandmarks();
  // RIGHT eye on screen-left half. Iris dead-centre of eye box.
  placeEye(lms, "right", { outerX: 0.30, innerX: 0.42, topY: 0.40, bottomY: 0.46, irisX: 0.36, irisY: 0.43 });
  placeEye(lms, "left",  { outerX: 0.70, innerX: 0.58, topY: 0.40, bottomY: 0.46, irisX: 0.64, irisY: 0.43 });
  g.update(lms);
  approx(g.horizontalRatio, 0.5, 0.05, "centered iris → horizontalRatio ≈ 0.5");
  approx(g.verticalRatio, 0.5, 0.05, "centered iris → verticalRatio ≈ 0.5");
  equal(g.gazeDirection, "center", "gazeDirection = center");
}

// --- 2. Iris near outer corner (looking far right on subject's screen) ----
{
  const g = new GazeTracker({ smoothing: false });
  const lms = blankLandmarks();
  // Right eye: outer=0.30, inner=0.42. Iris at outerX → looking far one way.
  placeEye(lms, "right", { outerX: 0.30, innerX: 0.42, topY: 0.40, bottomY: 0.46, irisX: 0.305, irisY: 0.43 });
  placeEye(lms, "left",  { outerX: 0.70, innerX: 0.58, topY: 0.40, bottomY: 0.46, irisX: 0.695, irisY: 0.43 });
  g.update(lms);
  ok(g.horizontalRatio < 0.15, `iris near outer corner → horizontalRatio < 0.15 (got ${g.horizontalRatio.toFixed(3)})`);
  equal(g.gazeDirection, "right", "gazeDirection = right");
}

// --- 3. Iris near inner corner (looking the other way) -------------------
{
  const g = new GazeTracker({ smoothing: false });
  const lms = blankLandmarks();
  placeEye(lms, "right", { outerX: 0.30, innerX: 0.42, topY: 0.40, bottomY: 0.46, irisX: 0.415, irisY: 0.43 });
  placeEye(lms, "left",  { outerX: 0.70, innerX: 0.58, topY: 0.40, bottomY: 0.46, irisX: 0.585, irisY: 0.43 });
  g.update(lms);
  ok(g.horizontalRatio > 0.85, `iris near inner corner → horizontalRatio > 0.85 (got ${g.horizontalRatio.toFixed(3)})`);
  equal(g.gazeDirection, "left", "gazeDirection = left");
}

// --- 4. Blink: eye-height tiny → blinkRatio large -----------------------
{
  const g = new GazeTracker({ smoothing: false });
  const lms = blankLandmarks();
  placeEye(lms, "right", { outerX: 0.30, innerX: 0.42, topY: 0.420, bottomY: 0.422, irisX: 0.36, irisY: 0.421 });
  placeEye(lms, "left",  { outerX: 0.70, innerX: 0.58, topY: 0.420, bottomY: 0.422, irisX: 0.64, irisY: 0.421 });
  g.update(lms);
  ok(g.blinkRatio > 5, `eye height tiny → blinkRatio > 5 (got ${g.blinkRatio.toFixed(1)})`);
  ok(!g.eyesOpen, "blink detected → eyesOpen=false");
}

// --- 5. Wrong landmark count returns null --------------------------------
{
  const g = new GazeTracker({ smoothing: false });
  equal(g.update([]), null, "empty landmarks → null");
  equal(g.update(blankLandmarks(468)), null, "<478 landmarks → null (refineLandmarks not active)");
}

// --- 6. getPoseOffset sign + scale ---------------------------------------
{
  const g = new GazeTracker({ smoothing: false });
  // Force a known "looking left" state.
  g.horizontalRatio = 0.8;   // looking left
  g.verticalRatio = 0.5;     // centred vertically
  const off = g.getPoseOffset({ gain: 1.0 });
  ok(off.x < 0, `looking-left → pose offset x < 0 (got ${off.x.toFixed(3)})`);
  approx(off.y, 0, 1e-9, "centred verticalRatio → pose offset y = 0");
  approx(off.z, 0, 1e-9, "gaze doesn't shift z");
}

// --- 7. Smoothing actually smooths ---------------------------------------
{
  const g = new GazeTracker({ smoothing: true });
  const lms = blankLandmarks();
  // Frame 1: looking left.
  placeEye(lms, "right", { outerX: 0.30, innerX: 0.42, topY: 0.40, bottomY: 0.46, irisX: 0.415, irisY: 0.43 });
  placeEye(lms, "left",  { outerX: 0.70, innerX: 0.58, topY: 0.40, bottomY: 0.46, irisX: 0.585, irisY: 0.43 });
  g.update(lms);
  const first = g.horizontalRatio;
  // Frame 2: looking centre. Smoothing should make the change gradual.
  placeEye(lms, "right", { outerX: 0.30, innerX: 0.42, topY: 0.40, bottomY: 0.46, irisX: 0.36, irisY: 0.43 });
  placeEye(lms, "left",  { outerX: 0.70, innerX: 0.58, topY: 0.40, bottomY: 0.46, irisX: 0.64, irisY: 0.43 });
  g.update(lms);
  ok(Math.abs(g.horizontalRatio - first) < 0.5, `1€ filter dampens a single big jump (first=${first.toFixed(2)}, then=${g.horizontalRatio.toFixed(2)})`);
}

report();
