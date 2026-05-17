// HandTracker — MediaPipe HandLandmarker driving cursor + gestures.
//
// Mirrors the shape of HeadTracker so callers can swap pose sources:
//   const pose = handTracker.getPose();   // { x, y, z, confidence, ... }
//   applyOffAxisProjection(camera, pose, screenMeters);
//
// Reuses the SAME @mediapipe/tasks-vision bundle that head_tracking.js
// already loads — `HandLandmarker` ships in that bundle so there's zero
// extra payload.
//
// Gesture math ported from ~/Projects/Minority Report/gestures/:
//   - 1€ filter for tip smoothing
//   - distance-based pinch with hysteresis (mac_trackpad_classifier.py)
//   - N-frame stability gate (gesture_confidence.py)

import { OneEuroVec } from "./onee_filter.js";
import { getSharedWebcam, releaseConsumer } from "./webcam.js";
import { HandGestureClassifier } from "./hand_filters.js";

const MEDIAPIPE_MODULE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs";
const MEDIAPIPE_WASM   = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const HAND_MODEL_URL   = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// MediaPipe hand-landmark indices we care about.
const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  INDEX_PIP: 6,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
};

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.running = false;
    this.video = null;
    this.stream = null;
    this._lastTimestamp = 0;
    // Smoothed pose exposed to consumers.
    this.pose = {
      x: 0, y: 0, z: 0.5,
      tip: { x: 0.5, y: 0.5 },     // [0,1] image-relative tip position
      pinch: 0,                     // 0..1 (1 = touching)
      pinchEdge: null,              // "down" | "up" | null — one-shot, cleared every poll
      gesture: "none",              // "point" | "pinch" | "fist" | "palm" | "peace" | "none"
      confidence: 0,
    };
    // 1€ filter for tip — kills jitter
    this._tipOEF = new OneEuroVec(2, { mincutoff: 1.6, beta: 0.04 });
    // yoha-style temporal gesture classifier (palm-normalized pinch + fist +
    // swipe). The classifier owns its own EMA + hysteresis + stability gate.
    this._gestures = new HandGestureClassifier();
    // Backstop pinch state for coarse classification (kept for `pose.gesture`
    // priority — we still treat pinch as the top-priority gesture).
    this._pinchClosed = false;
    // N-frame stability gate for the COARSE multi-gesture classifier.
    this._stableGesture = "none";
    this._streak = 0;
    this._lastFiredGesture = "none";
  }

  async init() {
    let vision;
    try {
      vision = await import(MEDIAPIPE_MODULE);
    } catch (e) {
      throw new Error("hand_mediapipe_load_failed: " + e.message);
    }
    const { HandLandmarker, FilesetResolver } = vision;

    // Reuse the shared webcam (single getUserMedia for the whole app).
    const { video, stream } = await getSharedWebcam("hand-tracker");
    this.video = video;
    this.stream = stream;

    try {
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
    } catch (e) {
      throw new Error("hand_model_load_failed: " + e.message);
    }
    return true;
  }

  start() {
    if (this.running || !this.landmarker) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const ts = performance.now();
      if (ts - this._lastTimestamp >= 33) {
        this._lastTimestamp = ts;
        try {
          const result = this.landmarker.detectForVideo(this.video, ts);
          this._processResult(result, ts);
        } catch (_) { /* transient — ignore */ }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    releaseConsumer("hand-tracker");
    this.video = null;
    this.stream = null;
  }

  // Returns the latest pose. Same shape as HeadTracker.getHeadPose() for
  // applyOffAxisProjection compatibility.
  getPose() {
    return this.pose;
  }

  calibrate() {
    this._tipOEF.reset();
    this.pose.x = 0; this.pose.y = 0; this.pose.z = 0.5;
  }

  // ----- internal -----------------------------------------------------------
  _processResult(result, tsMs) {
    const lms = result?.landmarks?.[0];
    if (!lms || lms.length < 21) {
      this.pose.confidence *= 0.85;
      this.pose.gesture = "none";
      return;
    }

    // Image-normalized coords: x ∈ [0,1] left→right, y ∈ [0,1] top→bottom.
    const tip = lms[LM.INDEX_TIP];
    const thumb = lms[LM.THUMB_TIP];
    const wrist = lms[LM.WRIST];
    const middle = lms[LM.MIDDLE_TIP];
    const indexPip = lms[LM.INDEX_PIP];

    // Smooth tip position with 1€ filter.
    const t = tsMs / 1000;
    const [sx, sy] = this._tipOEF.call([tip.x, tip.y], t);
    this.pose.tip.x = sx;
    this.pose.tip.y = sy;

    // Off-axis pose math. Convert image-x [0,1] (mirrored on user-facing cam)
    // to head-pose-style metres-ish coords. We preserve the same scale that
    // applyOffAxisProjection's screenMeters expects.
    //
    // Image is mirrored (selfie-mode), so move-right on screen = larger x
    // landmark. Convert to centred [-0.5, 0.5] then scale.
    const hx = (sx - 0.5) * 0.5;             // ±0.25 m horizontal
    const hy = -(sy - 0.5) * 0.3;            // ±0.15 m vertical (flip Y)

    // Hand "depth" — proxy by hand bounding-box size: closer hand = larger.
    // Distance from wrist to middle-tip in image space.
    const handSpan = Math.hypot(middle.x - wrist.x, middle.y - wrist.y);
    // Empirical: handSpan ≈ 0.18 mid-distance, ≈ 0.32 close, ≈ 0.10 far.
    // Map to proximity z where bigger = closer (matches HeadTracker convention).
    const proximity = Math.max(0.1, Math.min(1.5, handSpan * 4.5));

    this.pose.x = hx;
    this.pose.y = hy;
    this.pose.z = proximity;
    this.pose.confidence = 1.0;

    // ---- Pinch detection (palm-normalised, EMA-smoothed, hysteresis-gated) ----
    // Delegated to HandGestureClassifier (hand_filters.js). It owns the EMA,
    // hysteresis state machine and N-frame stability gating for the pinch
    // edge events. We surface `pose.pinch` (0..1) AND a one-shot edge event
    // `pose.pinchEdge ∈ {"down", "up", null}` that consumers (mapper synthetic
    // pointer events) read once per poll then clear.
    this._gestures.update(lms);
    const gp = this._gestures.pinch;
    this._pinchClosed = gp.active;
    this.pose.pinch = gp.active ? 1 : Math.max(0, 1 - gp.ratio / 0.6);
    this.pose.pinchEdge = gp.justClosed ? "down" : gp.justOpened ? "up" : null;

    // ---- Coarse pose classification (used for gesture-driven actions) ----
    // Count "fingers up": tip y is above (smaller than) pip y for that finger.
    const up = (tipIdx, pipIdx) => lms[tipIdx].y < lms[pipIdx].y - 0.02;
    const fIndex  = up(LM.INDEX_TIP,  LM.INDEX_PIP);
    const fMiddle = up(LM.MIDDLE_TIP, 10);
    const fRing   = up(LM.RING_TIP,   14);
    const fPinky  = up(LM.PINKY_TIP,  18);
    const upCount = [fIndex, fMiddle, fRing, fPinky].filter(Boolean).length;

    let candidate = "none";
    if (this._pinchClosed)                                  candidate = "pinch";
    else if (upCount >= 4)                                  candidate = "palm";
    else if (upCount === 0)                                 candidate = "fist";
    else if (fIndex && fMiddle && !fRing && !fPinky)        candidate = "peace";
    else if (fIndex && !fMiddle && !fRing && !fPinky)       candidate = "point";
    else                                                    candidate = "none";

    // N-frame stability gate (3 consecutive frames before we change state).
    if (candidate === this._stableGesture) {
      this._streak++;
    } else {
      this._stableGesture = candidate;
      this._streak = 1;
    }
    if (this._streak >= 3) this.pose.gesture = candidate;
  }
}

// Reuse the same off-axis frustum math as HeadTracker. Importing here saves
// app.js from caring whether the pose came from face or hand.
export { applyOffAxisProjection } from "./head_tracking.js";
