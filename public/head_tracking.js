// Head-tracking via MediaPipe FaceLandmarker → off-axis frustum parallax.
// Drives a "window into a world" effect: moving your head left/right/forward
// shifts the camera frustum (not just yaw), so near objects slide opposite
// to head motion and far objects barely move.
//
// Camera stream is now shared via ./webcam.js so HandTracker can run on the
// same frame without a second getUserMedia prompt.

import { getSharedWebcam, releaseConsumer } from "./webcam.js";

const MEDIAPIPE_MODULE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs";
const MEDIAPIPE_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export class HeadTracker {
  constructor() {
    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this.running = false;
    this.pose = { x: 0, y: 0, z: 0.5, confidence: 0 };
    this.calibrationOffset = { x: 0, y: 0, z: 0 };
    this.emaAlpha = 0.35;
    this._lastTimestamp = 0;
  }

  async init() {
    // 1. Dynamic import MediaPipe
    let vision;
    try {
      vision = await import(MEDIAPIPE_MODULE);
    } catch (e) {
      throw new Error("mediapipe_load_failed: " + e.message);
    }
    const { FaceLandmarker, FilesetResolver } = vision;

    // 2. Webcam — shared across face + hand trackers. webcam.js handles
    //    getUserMedia + the hidden <video> element + permission errors.
    try {
      const { video, stream } = await getSharedWebcam("head-tracker");
      this.video = video;
      this.stream = stream;
    } catch (e) {
      throw new Error("camera_denied: " + e.message);
    }

    // 3. Load model
    try {
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
    } catch (e) {
      throw new Error("model_load_failed: " + e.message);
    }
    return true;
  }

  start() {
    if (this.running || !this.landmarker) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const ts = performance.now();
      if (ts - this._lastTimestamp >= 33) { // ~30fps
        this._lastTimestamp = ts;
        try {
          const result = this.landmarker.detectForVideo(this.video, ts);
          const mats = result?.facialTransformationMatrixes;
          if (mats && mats.length > 0 && mats[0].data) {
            const d = mats[0].data;
            // Column-major 4x4: translation at indices 12,13,14 (in cm → convert to meters)
            const tx = d[12] / 100;
            const ty = d[13] / 100;
            // INVERT the raw Z: bigger headPose.z should mean "closer to screen"
            // so that lean-in produces a wider frustum and objects pop out.
            // MediaPipe reports face-to-camera distance in cm; invert + offset
            // so proximity maps to higher numbers.
            const rawZ = Math.abs(d[14]) / 100 || 0.5;
            const tz = Math.max(0.1, 1.2 - rawZ);
            const a = this.emaAlpha;
            this.pose.x = a * (tx - this.calibrationOffset.x) + (1 - a) * this.pose.x;
            this.pose.y = a * (ty - this.calibrationOffset.y) + (1 - a) * this.pose.y;
            this.pose.z = a * (tz - this.calibrationOffset.z) + (1 - a) * this.pose.z;
            this.pose.confidence = 1.0;
          } else {
            this.pose.confidence *= 0.9;
          }
        } catch (e) {
          // transient — ignore
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    // Don't kill the shared stream — other consumers may still use it.
    releaseConsumer("head-tracker");
    this.stream = null;
    this.video = null;
  }

  calibrate() {
    this.calibrationOffset.x = this.pose.x + this.calibrationOffset.x;
    this.calibrationOffset.y = this.pose.y + this.calibrationOffset.y;
    this.calibrationOffset.z = this.pose.z + this.calibrationOffset.z;
    this.pose.x = 0; this.pose.y = 0; this.pose.z = 0.5;
  }

  getHeadPose() {
    return this.pose;
  }
}

// Build an asymmetric (off-axis) frustum projection matrix. Near-plane edges
// are the world-space screen corners projected from the head's current position.
// Lateral head motion shears the frustum instead of rotating the camera —
// this is the "window into a world" math.
export function applyOffAxisProjection(camera, headPose, screenMeters = { w: 0.5, h: 0.28 }) {
  if (!camera || !headPose) return;
  const n = camera.near;
  const f = camera.far;
  const hx = headPose.x;
  const hy = headPose.y;
  // `headPose.z` is a PROXIMITY signal (higher = closer to screen). Convert
  // to a frustum-eye distance where smaller distance → wider frustum → bigger
  // objects = pop-out. Clamped to [0.15, 2.5] to keep math stable at extremes.
  const proximity = Math.max(0.05, headPose.z);
  const hz = Math.max(0.15, Math.min(2.5, 0.5 / (proximity * 0.8 + 0.2)));
  const halfW = screenMeters.w * 0.5;
  const halfH = screenMeters.h * 0.5;
  // Screen corners in camera-local coords (camera at head position looking -Z):
  const left   = (-halfW - hx) * n / hz;
  const right  = ( halfW - hx) * n / hz;
  const bottom = (-halfH - hy) * n / hz;
  const top    = ( halfH - hy) * n / hz;
  camera.projectionMatrix.makePerspective(left, right, top, bottom, n, f);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
