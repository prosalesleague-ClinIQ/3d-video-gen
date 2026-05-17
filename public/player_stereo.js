// Stereoscopic 3D output for the Player. Four modes:
//   "off"       — regular mono rendering
//   "sbs"       — side-by-side (for 3D TVs, 3D projectors with HDMI 1.4a "Side-by-Side Half")
//   "tb"        — top/bottom (aka "Over-Under", used by YouTube 3D and some 3D projectors)
//   "anaglyph"  — red/cyan glasses (works on any monitor, cheap cardboard glasses)
//
// Three.js has StereoEffect for SBS and AnaglyphEffect for red/cyan, but we
// also need TB, so we build a custom wrapper that renders two cameras to a
// single framebuffer via viewports.

import * as THREE from "three";

// Stereo cameras — two PerspectiveCameras offset by half the IPD along the
// parent camera's local X axis, both sharing the parent's projection.
class StereoCamera {
  constructor() {
    this.eyeSep = 0.064; // meters — average IPD
    this.camL = new THREE.PerspectiveCamera();
    this.camR = new THREE.PerspectiveCamera();
    this.camL.layers.enable(1);
    this.camR.layers.enable(2);
  }
  update(camera) {
    this.camL.copy(camera);
    this.camR.copy(camera);
    const off = this.eyeSep * 0.5;
    this.camL.translateX(-off);
    this.camR.translateX( off);
    this.camL.updateMatrixWorld();
    this.camR.updateMatrixWorld();
    this.camL.aspect = camera.aspect;
    this.camR.aspect = camera.aspect;
    this.camL.updateProjectionMatrix();
    this.camR.updateProjectionMatrix();
  }
}

// Anaglyph: render left eye masked to red channel, right eye masked to
// green+blue (cyan). Implemented as two passes that clear different channels
// via colorMask.
class AnaglyphRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.stereo = new StereoCamera();
    this._clear = true;
  }
  render(scene, camera) {
    const r = this.renderer;
    const gl = r.getContext();
    this.stereo.update(camera);

    // Save current state
    const prevAutoClear = r.autoClear;
    r.autoClear = true;
    r.clear();

    // Left eye — red only.
    gl.colorMask(true, false, false, true);
    r.autoClear = false;
    r.render(scene, this.stereo.camL);

    // Right eye — green + blue only.
    gl.colorMask(false, true, true, true);
    r.render(scene, this.stereo.camR);

    // Restore
    gl.colorMask(true, true, true, true);
    r.autoClear = prevAutoClear;
  }
}

// SBS / TB renderer — two viewports per frame.
class ViewportStereoRenderer {
  constructor(renderer, layout) {
    this.renderer = renderer;
    this.stereo = new StereoCamera();
    this.layout = layout; // "sbs" or "tb"
  }
  render(scene, camera) {
    const r = this.renderer;
    this.stereo.update(camera);
    const size = new THREE.Vector2();
    r.getSize(size);
    const w = size.x | 0;
    const h = size.y | 0;
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.clear();
    r.setScissorTest(true);
    if (this.layout === "sbs") {
      const hw = w / 2;
      r.setScissor(0,   0, hw, h); r.setViewport(0,   0, hw, h); r.render(scene, this.stereo.camL);
      r.setScissor(hw,  0, hw, h); r.setViewport(hw,  0, hw, h); r.render(scene, this.stereo.camR);
    } else { // tb
      const hh = h / 2;
      r.setScissor(0, hh, w, hh); r.setViewport(0, hh, w, hh); r.render(scene, this.stereo.camL);
      r.setScissor(0, 0,  w, hh); r.setViewport(0, 0,  w, hh); r.render(scene, this.stereo.camR);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.autoClear = prevAutoClear;
  }
}

export class StereoOutput {
  constructor(renderer) {
    this.renderer = renderer;
    this.mode = "off";
    this._impl = null;
  }
  setMode(mode) {
    this.mode = mode;
    if (mode === "anaglyph") this._impl = new AnaglyphRenderer(this.renderer);
    else if (mode === "sbs" || mode === "tb") this._impl = new ViewportStereoRenderer(this.renderer, mode);
    else this._impl = null;
  }
  setEyeSep(m) {
    if (this._impl?.stereo) this._impl.stereo.eyeSep = m;
  }
  // Return true if active (host renderer should skip its own render).
  render(scene, camera) {
    if (!this._impl) return false;
    this._impl.render(scene, camera);
    return true;
  }
}

export const STEREO_MODES = [
  { id: "off",      name: "Off",          icon: "—" },
  { id: "anaglyph", name: "Anaglyph (red/cyan)", icon: "🥽" },
  { id: "sbs",      name: "Side-by-side", icon: "⬌" },
  { id: "tb",       name: "Top / bottom", icon: "⬍" },
];
