// HandGestureClassifier — pinch / fist / open-palm state machine.
//
// Tests:
//  1. Open hand for several frames → not pinched, no edges.
//  2. Move thumb-tip onto index-tip → fires `justClosed` once after stability gate, then stays active.
//  3. Release → fires `justOpened` once, then idle.
//  4. Fist landmarks → fist.active true, openPalm.active false.
//  5. Open-palm landmarks → openPalm.active true, fist.active false.
//  6. Swipe: index-tip moves rapidly across frames → magnitude > 0.

import { HandGestureClassifier, EMA, computeApproximatePalmSize } from "../public/hand_filters.js";
import { suite, ok, equal, approx, report } from "./_assert.mjs";

suite("HandGestureClassifier");

// Build a synthetic 21-landmark array. Index 0=wrist; 4=thumb tip; 8=index tip.
// All landmarks normalized [0,1].
function mkHand({ pinch = false, fist = false, palm = false, tipPos = { x: 0.5, y: 0.4 } } = {}) {
  // Base: wrist at (0.5, 0.9), fingers spread upward.
  const wrist = { x: 0.5, y: 0.9 };
  const lms = new Array(21);
  lms[0] = wrist;
  // Thumb chain — 1..4. Tip at landmarks[4].
  const thumbTipPos = pinch ? { x: tipPos.x + 0.005, y: tipPos.y + 0.005 } : { x: 0.35, y: 0.55 };
  for (let i = 1; i <= 4; i++) lms[i] = lerp(wrist, thumbTipPos, i / 4);
  // Index — 5..8.
  const indexTipPos = fist ? { x: 0.5, y: 0.75 } : palm ? { x: 0.5, y: 0.2 } : tipPos;
  for (let i = 5; i <= 8; i++) lms[i] = lerp(wrist, indexTipPos, (i - 4) / 4);
  // Middle — 9..12.
  const middleTipPos = fist ? { x: 0.55, y: 0.78 } : palm ? { x: 0.55, y: 0.18 } : { x: 0.6, y: 0.45 };
  for (let i = 9; i <= 12; i++) lms[i] = lerp(wrist, middleTipPos, (i - 8) / 4);
  // Ring — 13..16.
  const ringTipPos = fist ? { x: 0.6, y: 0.8 } : palm ? { x: 0.6, y: 0.2 } : { x: 0.65, y: 0.5 };
  for (let i = 13; i <= 16; i++) lms[i] = lerp(wrist, ringTipPos, (i - 12) / 4);
  // Pinky — 17..20.
  const pinkyTipPos = fist ? { x: 0.65, y: 0.82 } : palm ? { x: 0.65, y: 0.25 } : { x: 0.7, y: 0.55 };
  for (let i = 17; i <= 20; i++) lms[i] = lerp(wrist, pinkyTipPos, (i - 16) / 4);
  return lms;
}
function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

// --- EMA sanity ---------------------------------------------------------
{
  const e = new EMA(0.5);
  ok(e.get() == null, "EMA before first add is null");
  e.add(10);
  approx(e.get(), 10, 1e-9, "EMA first add returns input");
  e.add(20);
  approx(e.get(), 15, 1e-9, "EMA second add ≈ midpoint with α=0.5");
}

// --- palm-size sanity ---------------------------------------------------
{
  const lms = mkHand({});
  const palm = computeApproximatePalmSize(lms);
  ok(palm > 0 && palm < 1, `computeApproximatePalmSize positive + bounded (got ${palm.toFixed(3)})`);
}

// --- 1. open hand → no pinch -------------------------------------------
{
  const c = new HandGestureClassifier();
  for (let i = 0; i < 6; i++) c.update(mkHand({ pinch: false }));
  ok(!c.pinch.active, "open hand for 6 frames → pinch.active=false");
  ok(!c.pinch.justClosed, "open hand → no justClosed edge");
}

// --- 2. transition to pinch fires exactly one justClosed --------------
{
  const c = new HandGestureClassifier();
  // Prime with open frames.
  for (let i = 0; i < 5; i++) c.update(mkHand({ pinch: false }));
  let closedCount = 0;
  // Switch to pinch and run enough frames to pass the stability gate.
  for (let i = 0; i < 6; i++) {
    c.update(mkHand({ pinch: true }));
    if (c.pinch.justClosed) closedCount++;
  }
  equal(closedCount, 1, "pinch transition fires justClosed exactly once");
  ok(c.pinch.active, "after stability gate, pinch.active=true");
}

// --- 3. release fires exactly one justOpened --------------------------
{
  const c = new HandGestureClassifier();
  for (let i = 0; i < 5; i++) c.update(mkHand({ pinch: false }));
  for (let i = 0; i < 5; i++) c.update(mkHand({ pinch: true }));
  let openedCount = 0;
  for (let i = 0; i < 6; i++) {
    c.update(mkHand({ pinch: false }));
    if (c.pinch.justOpened) openedCount++;
  }
  equal(openedCount, 1, "release fires justOpened exactly once");
  ok(!c.pinch.active, "after release stability gate, pinch.active=false");
}

// --- 4. fist landmarks → fist.active = true ---------------------------
{
  const c = new HandGestureClassifier();
  for (let i = 0; i < 4; i++) c.update(mkHand({ fist: true }));
  ok(c.fist.active, "fist landmarks → fist.active=true");
  ok(!c.openPalm.active, "fist landmarks → openPalm.active=false");
}

// --- 5. open-palm landmarks → openPalm.active = true ------------------
{
  const c = new HandGestureClassifier();
  for (let i = 0; i < 4; i++) c.update(mkHand({ palm: true }));
  ok(c.openPalm.active, "open-palm landmarks → openPalm.active=true");
  ok(!c.fist.active, "open-palm landmarks → fist.active=false");
}

// --- 6. swipe magnitude positive when tip moves quickly ---------------
{
  const c = new HandGestureClassifier();
  // Tip slides from x=0.2 to x=0.8 over 8 frames.
  for (let i = 0; i < 8; i++) {
    const tipX = 0.2 + (i / 7) * 0.6;
    c.update(mkHand({ tipPos: { x: tipX, y: 0.4 } }));
  }
  ok(c.swipe.magnitude > 0, `swipe.magnitude positive (${c.swipe.magnitude.toFixed(3)})`);
  ok(c.swipe.dx > 0.5, `swipe.dx captures rightward motion (${c.swipe.dx.toFixed(2)})`);
}

// --- 7. classifier handles short/missing landmark arrays gracefully ---
{
  const c = new HandGestureClassifier();
  c.update(null);
  c.update([{ x: 0.5, y: 0.5 }]);   // too few
  c.update(undefined);
  ok(!c.pinch.active, "null / short input does not crash and leaves pinch inactive");
}

report();
