// hand_filters.js — temporal hand-gesture classifiers.
//
// Composed from three sources, all light-touch:
//   1. yoha-main/src/util/ema.ts — ExponentialMovingAverage (MIT)
//   2. yoha-main/src/util/hand_helper.ts — ComputeApproximatePalmSizePx (MIT)
//   3. our own onee_filter.js — 1€ filter (already in this project)
//
// What this gives us over the threshold-only pinch detection in hand_tracking.js:
//   - palm-size-normalised pinch ratio (works at any hand-to-camera distance)
//   - EMA-smoothed ratio (kills frame-by-frame jitter without 1€'s adaptive lag)
//   - hysteresis-with-state-machine (a closed pinch needs a clearly-open frame
//     before it'll re-fire — prevents pinch chatter)
//   - N-frame stability gating (the "pinch closed" event must hold ≥ K frames)
//   - fist + open-palm + swipe-velocity detectors for free (same 21-pt topology)
//
// All inputs are MediaPipe HandLandmarker's normalized landmarks (each
// `{ x: 0..1, y: 0..1, z }` in image coords). Index map:
//   0  wrist
//   1-4   thumb (base→tip; 4 = thumb tip)
//   5-8   index (base→tip; 8 = index tip)
//   9-12  middle
//   13-16 ring
//   17-20 pinky
//
// API:
//   const c = new HandGestureClassifier();
//   c.update(landmarks);          // call once per frame
//   c.pinch                       // { active: bool, justClosed: bool, justOpened: bool, ratio: 0..1 }
//   c.fist                        // { active: bool, score: 0..1 }
//   c.openPalm                    // { active: bool, score: 0..1 }
//   c.swipe                       // { dx: -1..1, dy: -1..1, magnitude: px/frame }

// ---------- EMA -------------------------------------------------------------
export class EMA {
  constructor(alpha = 0.5) { this.alpha = alpha; this.value = null; }
  add(v) {
    if (this.value == null) this.value = v;
    else this.value = this.value * (1 - this.alpha) + v * this.alpha;
    return this.value;
  }
  get() { return this.value; }
  reset() { this.value = null; }
}

// ---------- palm-size estimator (yoha-style, max-of-six-pairs) --------------
const _PALM_PAIRS = [
  [0, 5], [0, 9], [0, 13], [0, 17],  // wrist→knuckles
  [5, 17],                            // index-knuckle → pinky-knuckle (palm width)
  [4, 20],                            // thumb-tip → pinky-tip (rough hand spread)
];

export function computeApproximatePalmSize(landmarks) {
  let maxD = -1;
  for (const [a, b] of _PALM_PAIRS) {
    const la = landmarks[a], lb = landmarks[b];
    if (!la || !lb) continue;
    const dx = la.x - lb.x, dy = la.y - lb.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxD) maxD = d;
  }
  return maxD > 0 ? maxD : 0.001;
}

// ---------- the gesture classifier ------------------------------------------
const DEFAULTS = {
  pinchCloseRatio: 0.32,   // thumb-tip ↔ index-tip < this × palmSize  → "closed"
  pinchOpenRatio: 0.55,    // ratio > this × palmSize                   → "open"
  pinchStabilityFrames: 2, // ms-equivalent ≈ 60ms @ 30fps
  emaAlpha: 0.45,          // smoothing on the raw pinch ratio
  fistRatio: 0.45,         // every finger tip closer than this × palmSize to wrist → fist
  openPalmRatio: 0.85,     // every finger tip farther than this × palmSize from wrist → open palm
  swipeBufferFrames: 8,    // velocity window for the swipe detector
};

export class HandGestureClassifier {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this._pinchEma = new EMA(this.cfg.emaAlpha);
    this._pinchState = "open";          // "open" | "closed"
    this._pinchEdgeFrames = 0;          // how long the current candidate state has held
    this._lastPinchState = "open";
    this._tipTrail = [];                // for swipe
    this.pinch = { active: false, justClosed: false, justOpened: false, ratio: 1, score: 0 };
    this.fist = { active: false, score: 0 };
    this.openPalm = { active: false, score: 0 };
    this.swipe = { dx: 0, dy: 0, magnitude: 0 };
  }

  reset() {
    this._pinchEma.reset();
    this._pinchState = "open";
    this._pinchEdgeFrames = 0;
    this._lastPinchState = "open";
    this._tipTrail.length = 0;
    this.pinch.active = false;
    this.pinch.justClosed = false;
    this.pinch.justOpened = false;
  }

  update(landmarks) {
    this.pinch.justClosed = false;
    this.pinch.justOpened = false;

    if (!landmarks || landmarks.length < 21) {
      this.reset();
      return;
    }

    const palmSize = computeApproximatePalmSize(landmarks);

    // --- pinch -------------------------------------------------------------
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const dxPi = thumbTip.x - indexTip.x;
    const dyPi = thumbTip.y - indexTip.y;
    const rawPinch = Math.sqrt(dxPi * dxPi + dyPi * dyPi) / palmSize;
    const smoothed = this._pinchEma.add(rawPinch);
    this.pinch.ratio = smoothed;
    // 0 when fingers touching, 1 when fully extended.
    this.pinch.score = Math.max(0, Math.min(1, 1 - smoothed / this.cfg.pinchOpenRatio));

    // Hysteresis state machine.
    const candidate = smoothed < this.cfg.pinchCloseRatio ? "closed"
                    : smoothed > this.cfg.pinchOpenRatio  ? "open"
                    : this._pinchState;   // dead band keeps last state
    if (candidate !== this._pinchState) {
      this._pinchEdgeFrames++;
      if (this._pinchEdgeFrames >= this.cfg.pinchStabilityFrames) {
        this._lastPinchState = this._pinchState;
        this._pinchState = candidate;
        this._pinchEdgeFrames = 0;
        if (this._pinchState === "closed") this.pinch.justClosed = true;
        else this.pinch.justOpened = true;
      }
    } else {
      this._pinchEdgeFrames = 0;
    }
    this.pinch.active = this._pinchState === "closed";

    // --- fist / open palm --------------------------------------------------
    const wrist = landmarks[0];
    const tips = [landmarks[4], landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
    let closeCount = 0, farCount = 0;
    const sumDist = tips.reduce((acc, t) => {
      const dx = t.x - wrist.x, dy = t.y - wrist.y;
      const d = Math.sqrt(dx * dx + dy * dy) / palmSize;
      if (d < this.cfg.fistRatio) closeCount++;
      if (d > this.cfg.openPalmRatio) farCount++;
      return acc + d;
    }, 0);
    const avgDist = sumDist / tips.length;
    this.fist.active = closeCount >= 4;
    this.fist.score = Math.max(0, Math.min(1, 1 - avgDist / this.cfg.openPalmRatio));
    this.openPalm.active = farCount >= 4;
    this.openPalm.score = Math.max(0, Math.min(1, avgDist / 1.2));

    // --- swipe (index-tip velocity over rolling buffer) --------------------
    this._tipTrail.push({ x: indexTip.x, y: indexTip.y, t: performance.now() });
    if (this._tipTrail.length > this.cfg.swipeBufferFrames) this._tipTrail.shift();
    if (this._tipTrail.length >= 3) {
      const first = this._tipTrail[0];
      const last = this._tipTrail[this._tipTrail.length - 1];
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const dt = Math.max(1, last.t - first.t);
      const mag = Math.sqrt(dx * dx + dy * dy) / (dt / 1000);
      this.swipe.dx = dx;
      this.swipe.dy = dy;
      this.swipe.magnitude = mag;
    } else {
      this.swipe.dx = 0; this.swipe.dy = 0; this.swipe.magnitude = 0;
    }
  }
}

export default HandGestureClassifier;
