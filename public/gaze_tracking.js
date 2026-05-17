// gaze_tracking.js — gaze direction from MediaPipe FaceLandmarker iris landmarks.
//
// Concept ported from `GazeTracking` (https://github.com/antoinelame/GazeTracking,
// MIT). The Python project uses dlib + OpenCV adaptive threshold + contour
// centroid to find the pupil; we skip all of that because MediaPipe's
// FaceLandmarker (`outputFacialTransformationMatrixes: true,
// numFaces: 1, refineLandmarks: true`) already exposes 478 landmarks INCLUDING
// the iris (468–477). The original ratio math is what we want — port it 1:1.
//
// MediaPipe iris landmark map (per the model card):
//   468  RIGHT iris center        (anatomical left of subject — user's right eye)
//   469-472  iris-corner perimeter for the right iris
//   473  LEFT iris center
//   474-477  iris-corner perimeter for the left iris
//
// Eye-bounding landmarks (we use these as the eye box that the iris moves
// within — same role as dlib's 6-point eye in GazeTracking):
//   right eye: 33 (outer corner) / 133 (inner corner) / 159 (top lid) / 145 (bottom lid)
//   left  eye: 362 (inner corner) / 263 (outer corner) / 386 (top lid) / 374 (bottom lid)
//
// All landmarks come from MediaPipe in normalized image coordinates: 0..1.
//
// Output ratios match GazeTracking's convention:
//   horizontalRatio: 0.0 = looking far right, 0.5 = center, 1.0 = looking far left
//   verticalRatio:   0.0 = looking far up,   0.5 = center, 1.0 = looking far down
//   blinkRatio:      width / height of eye box; > ~5 = closed
//
// Combined with the 1€ filter we already have, gaze is buttery.

import { OneEuroFilter } from "./onee_filter.js";

const RIGHT = { iris: 468, outer: 33, inner: 133, top: 159, bottom: 145 };
const LEFT  = { iris: 473, outer: 263, inner: 362, top: 386, bottom: 374 };

function _ratiosFor(eye, landmarks) {
  const iris = landmarks[eye.iris];
  const outer = landmarks[eye.outer];
  const inner = landmarks[eye.inner];
  const top = landmarks[eye.top];
  const bottom = landmarks[eye.bottom];
  if (!iris || !outer || !inner || !top || !bottom) return null;

  const eyeWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  const eyeHeight = Math.hypot(top.x - bottom.x, top.y - bottom.y);

  // Pick "inner" vs "outer" corner so horizontalRatio increases as the user
  // looks left, matching GazeTracking's convention.
  // For the right eye, outer corner is on the screen-left; inner corner on
  // the screen-right (mirror-image of the subject's face).
  const dxFromOuter = Math.hypot(iris.x - outer.x, iris.y - outer.y);
  const hRatio = eyeWidth > 1e-6 ? dxFromOuter / eyeWidth : 0.5;

  const dyFromTop = Math.hypot(iris.x - top.x, iris.y - top.y);
  const vRatio = eyeHeight > 1e-6 ? dyFromTop / eyeHeight : 0.5;

  const blink = eyeHeight > 1e-6 ? eyeWidth / eyeHeight : 999;

  return { hRatio, vRatio, blink };
}

export class GazeTracker {
  constructor({ smoothing = true } = {}) {
    this._smoothing = smoothing;
    // Two filters: one for horizontal ratio, one for vertical. Tuned for the
    // ~30 fps face-landmarker tick rate; mincutoff a bit higher than the hand
    // tracker because gaze ratios are inherently noisier (iris ≈ 4 pixels).
    this._hFilter = smoothing ? new OneEuroFilter({ mincutoff: 1.0, beta: 0.05 }) : null;
    this._vFilter = smoothing ? new OneEuroFilter({ mincutoff: 1.0, beta: 0.05 }) : null;
    this.horizontalRatio = 0.5;
    this.verticalRatio = 0.5;
    this.blinkRatio = 0;
    this.eyesOpen = true;
    this.gazeDirection = "center";   // "left" / "right" / "up" / "down" / "center"
  }

  reset() {
    if (this._hFilter) this._hFilter.reset();
    if (this._vFilter) this._vFilter.reset();
    this.horizontalRatio = 0.5;
    this.verticalRatio = 0.5;
    this.gazeDirection = "center";
  }

  /**
   * Feed in MediaPipe FaceLandmarker landmarks (the `landmarks[0]` array with
   * 478 points when refineLandmarks is enabled).
   * Returns the current ratios — handy for chaining.
   */
  update(landmarks) {
    if (!landmarks || landmarks.length < 478) {
      // Iris landmarks (468–477) require refineLandmarks=true. Bail silently.
      return null;
    }
    const r = _ratiosFor(RIGHT, landmarks);
    const l = _ratiosFor(LEFT, landmarks);
    if (!r || !l) return null;

    let h = (r.hRatio + l.hRatio) / 2;
    let v = (r.vRatio + l.vRatio) / 2;
    const blink = (r.blink + l.blink) / 2;

    if (this._hFilter) {
      const t = performance.now() / 1000;
      h = this._hFilter.call(h, t);
      v = this._vFilter.call(v, t);
    }

    this.horizontalRatio = h;
    this.verticalRatio = v;
    this.blinkRatio = blink;
    this.eyesOpen = blink < 5;

    this.gazeDirection =
      h < 0.35 ? "right" :
      h > 0.65 ? "left"  :
      v < 0.30 ? "up"    :
      v > 0.70 ? "down"  : "center";

    return { horizontalRatio: h, verticalRatio: v, blinkRatio: blink, direction: this.gazeDirection };
  }

  /**
   * Convert ratios to a pose offset suitable for `applyOffAxisProjection`.
   * Returns an `{ x, y, z }` in the same units as `HeadTracker.getHeadPose()`:
   *   - x, y in meters from screen-center, signs match head-tracker convention
   *   - z = subject's apparent depth from the camera (left untouched here;
   *     caller composes gaze + head pose)
   *
   * Tunables:
   *   gain   — how much screen-meters the eyeballs add per ratio-unit
   *            (typical 0.05–0.15; default 0.08 is conservative)
   *   invertX/invertY — flip axes if the parallax feels wrong on your rig
   */
  getPoseOffset({ gain = 0.08, invertX = false, invertY = false } = {}) {
    // Centered ratios: 0 = center, ±0.5 = looking far one direction.
    const cx = 0.5 - this.horizontalRatio;   // looking-right is negative ratio
    const cy = this.verticalRatio - 0.5;     // looking-down is positive ratio
    return {
      x: gain * (invertX ? -cx : cx),
      y: gain * (invertY ? -cy : cy),
      z: 0,
    };
  }
}

export default GazeTracker;
