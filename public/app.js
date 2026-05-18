// Kaleidoscope studio — Three.js viewer + Director panel + photo-to-3D + storyboard film compiler.

import * as THREE from "three";
import { WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace } from "three";
// AgX + Neutral are vivid-preserving tonemaps (available in three r162+).
// Fall back to ACESFilmic if this build of three is older.
const AgXToneMapping = THREE.AgXToneMapping ?? null;
const NeutralToneMapping = THREE.NeutralToneMapping ?? null;
const VIVID_TONEMAP = AgXToneMapping ?? NeutralToneMapping ?? ACESFilmicToneMapping;
// WebGPURenderer is only in the webgpu-bundled subpath (opt-in via ?webgpu=1).
let WebGPURenderer = null;
try {
  const wg = await import("three/webgpu");
  WebGPURenderer = wg.WebGPURenderer || null;
} catch (_) { /* WebGPU bundle unavailable — stays null */ }
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

// Realism + POV-parallax upgrade modules
import { HeadTracker, applyOffAxisProjection } from "./head_tracking.js";
import { HandTracker } from "./hand_tracking.js";
import { KaleidoEffect } from "./kaleido_shader.js";
import { mountSplatViewer, SAMPLE_SPLATS } from "./splat_viewer.js";
import { ProjectionMode, PRESETS as PROJECTION_PRESETS } from "./projection_mapping.js";
import { StereoOutput, STEREO_MODES } from "./player_stereo.js";
import { applyPreset, loadPreset, savePreset } from "./quality.js";

RectAreaLightUniformsLib.init();

// HDRI URLs (Poly Haven CC0, 1k)
const HDRI_URLS = {
  studio: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_08_1k.hdr",
  sunset: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kiara_1_dawn_1k.hdr",
  night:  "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr",
  forest: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/symmetrical_garden_02_1k.hdr",
};

const BACKEND = window.__BACKEND_URL__ || "";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const STORAGE_KEY = "studio_storyboard_v1";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const els = {
  canvas: document.getElementById("gl"),
  holder: document.getElementById("canvas-holder"),
  fps: document.getElementById("fps"),
  prompt: document.getElementById("prompt"),
  submit: document.getElementById("submit"),
  modeBtns: document.querySelectorAll(".mode-btn"),
  resetView: document.getElementById("reset-view"),
  downloadBtn: document.getElementById("download-mp4"),
  addToStoryboard: document.getElementById("add-to-storyboard"),
  compileFilm: document.getElementById("compile-film"),
  clearStoryboard: document.getElementById("clear-storyboard"),
  storyboardList: document.getElementById("storyboard-list"),
  filmProgress: document.getElementById("film-progress"),
  filmResult: document.getElementById("film-result"),
  finalFilm: document.getElementById("final-film"),
  filmMetaLabel: document.getElementById("film-meta-label"),
  filmDownload: document.getElementById("film-download"),
  progress: document.getElementById("progress"),
  progressLabel: document.getElementById("progress-label"),
  progressElapsed: document.getElementById("progress-elapsed"),
  progressBar: document.getElementById("progress-bar"),
  errorBox: document.getElementById("error-box"),
  statusPill: document.getElementById("status-pill"),
  sceneCount: document.getElementById("scene-count"),
  sceneGraphPre: document.getElementById("scene-graph"),
  exampleChips: document.querySelectorAll(".example-chip"),
  viewerHint: document.getElementById("viewer-hint"),
  // Director
  aiDirect: document.getElementById("ai-direct"),
  manualControls: document.getElementById("manual-controls"),
  shotSel: document.getElementById("shot"),
  lightingSel: document.getElementById("lighting"),
  moodSel: document.getElementById("mood"),
  paceSel: document.getElementById("pace"),
  directorHint: document.getElementById("director-hint"),
  directorDetails: document.getElementById("director-details"),
  // Photo upload
  dropZone: document.getElementById("drop-zone"),
  photoInput: document.getElementById("photo-input"),
  photoPreview: document.getElementById("photo-preview"),
  photoGenerate: document.getElementById("photo-generate"),
  // Director Q&A
  directQuestions: document.getElementById("direct-questions"),
  qaBody: document.getElementById("qa-body"),
  qaSubmit: document.getElementById("qa-submit"),
  qaSkip: document.getElementById("qa-skip"),
  // Fullscreen + projection controls
  fullscreenBtn: document.getElementById("btn-fullscreen"),
  projectionSrcBtns: document.querySelectorAll("#projection-calibration [data-proj-src]"),
  projectionSaveBtn: document.getElementById("projection-save"),
  projectionLoadInput: document.getElementById("projection-load"),
  projectionDetectBtn: document.getElementById("projection-detect"),
};

// ---------------------------------------------------------------------------
// Renderer + scene setup (async — WebGPURenderer.init() is a Promise)
// ---------------------------------------------------------------------------
let renderer, scene, camera, controls, composer, bloomPass;

async function createRenderer(canvas) {
  // NOTE: forcing WebGL2 for now. The post-FX pipeline (EffectComposer from
  // three/addons, SMAA, bloom) and pmrem IBL require a WebGL2 context.
  // Opt-in WebGPU via `?webgpu=1` for experimentation; post-FX will be skipped.
  const wantWebGPU = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("webgpu") &&
    typeof navigator !== "undefined" && "gpu" in navigator;
  if (wantWebGPU && WebGPURenderer) {
    try {
      const r = new WebGPURenderer({ canvas, antialias: true, powerPreference: "high-performance" });
      await r.init();
      r.outputColorSpace = SRGBColorSpace;
      r.toneMapping = VIVID_TONEMAP;
      r.toneMappingExposure = 1.3;
      return { renderer: r, backend: "webgpu" };
    } catch (e) {
      console.warn("WebGPU init failed, falling back to WebGL2", e);
    }
  }
  const r = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  r.outputColorSpace = SRGBColorSpace;
  r.toneMapping = VIVID_TONEMAP;
  r.toneMappingExposure = 1.3;
  return { renderer: r, backend: "webgl2" };
}

function resize() {
  const w = els.holder.clientWidth;
  const h = els.holder.clientHeight;
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  if (bloomPass) bloomPass.setSize(w, h);
  if (smaaPass) smaaPass.setSize(w, h);
  if (kaleidoEffect) kaleidoEffect.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!povActive) {
    baseProjectionMatrix = camera.projectionMatrix.clone();
  }
  // Re-apply preset so renderScale stays consistent.
  if (renderer && composer && typeof loadPreset === "function") {
    try { applyPreset(loadPreset(), { renderer, composer, keyLight }); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentScene = null;
let dynamicObjects = [];
let kaleidoClones = [];
let activeLights = [];
let ambientLight = null;
let currentSceneMeta = null;  // {render_id, prompt, scene_graph}
let currentPhotoData = null;  // base64 when photo uploaded

// Realism + POV upgrade state
let keyLight = null;
let rimLight = null;
let pmrem = null;
let currentHDRI = "studio";
let smaaPass = null;
let kaleidoEffect = null;
let splatHandle = null;
let projectionHandle = null;
let stereoOutput = null; // StereoOutput — Off by default, activated via toolbar pill
let headTracker = null;
let povActive = false;
let handTracker = null;
// "off" | "face" | "hand" — which tracker drives off-axis parallax.
let povSource = "off";
let baseProjectionMatrix = null;

const state = {
  mode: "orbit",
  tourT: 0,
  tourDuration: 8.0,
  animT: 0,
  animDuration: 4.0,
  kaleidoSegments: 6,
  // "Pop-out" depth multiplier (1 = baseline, 3 = aggressive parallax + strong
  // off-axis frustum). Driven by the Depth slider below + setDepthIntensity().
  depthIntensity: 2.0,
  parallax: { x: 0, y: 0, tx: 0, ty: 0 },
};

// ---------------------------------------------------------------------------
// Scene building
// ---------------------------------------------------------------------------
const geomCache = new Map();

function geomFor(asset) {
  if (geomCache.has(asset)) return geomCache.get(asset);
  let geom;
  switch (asset) {
    case "sphere":   geom = new THREE.SphereGeometry(1, 32, 24); break;
    case "cylinder": geom = new THREE.CylinderGeometry(1, 1, 2, 32); break;
    case "cone":     geom = new THREE.ConeGeometry(1, 2, 32); break;
    case "plane":    geom = new THREE.PlaneGeometry(2, 2); break;
    case "torus":    geom = new THREE.TorusGeometry(1.2, 0.4, 20, 40); break;
    case "monkey":   geom = new THREE.IcosahedronGeometry(1, 2); break;
    case "cube":
    default:         geom = new THREE.BoxGeometry(2, 2, 2);
  }
  geomCache.set(asset, geom);
  return geom;
}

function disposeMesh(mesh) {
  if (mesh.material) {
    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
    else mesh.material.dispose();
  }
}

function clearScene() {
  [...dynamicObjects, ...kaleidoClones, ...activeLights].forEach(obj => {
    scene.remove(obj);
    if (obj.geometry && !geomCache.has(obj.userData.assetKey)) obj.geometry.dispose();
    disposeMesh(obj);
  });
  if (ambientLight) { scene.remove(ambientLight); ambientLight = null; }
  dynamicObjects = [];
  kaleidoClones = [];
  activeLights = [];
}

function makeMaterial(objDef) {
  const color = objDef.color || [0.8, 0.3, 0.3, 1.0];
  const emissive = objDef.emissive || [0, 0, 0];
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color[0], color[1], color[2]),
    metalness: objDef.metallic ?? 0.15,
    roughness: objDef.roughness ?? 0.4,
    emissive: new THREE.Color(emissive[0], emissive[1], emissive[2]),
    emissiveIntensity: 1.0,
  });
}

function makeLight(lightDef) {
  const type = (lightDef.type || "AREA").toUpperCase();
  const color = lightDef.color || [1, 1, 1];
  const colorObj = new THREE.Color(color[0], color[1], color[2]);
  const energy = lightDef.energy || 800;
  const loc = lightDef.location || [0, 5, 0];

  if (type === "SUN" || type === "DIRECTIONAL") {
    const light = new THREE.DirectionalLight(colorObj, energy / 500);
    light.position.set(...loc);
    return light;
  }
  if (type === "POINT") {
    const light = new THREE.PointLight(colorObj, energy / 150, 50, 2);
    light.position.set(...loc);
    return light;
  }
  const size = lightDef.size || 4;
  const light = new THREE.RectAreaLight(colorObj, energy / 100, size, size);
  light.position.set(...loc);
  light.lookAt(0, 0, 0);
  return light;
}

function buildScene(graph) {
  clearScene();

  const bg = graph?.world?.background || [0.04, 0.04, 0.08];
  scene.background = new THREE.Color(bg[0], bg[1], bg[2]);
  const fogDensity = graph?.world?.fog_density ?? 0.01;
  scene.fog = new THREE.FogExp2(scene.background, fogDensity);

  ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambientLight);

  const lights = graph.lights || (graph.light ? [graph.light] : []);
  lights.forEach(l => {
    const light = makeLight(l);
    scene.add(light);
    activeLights.push(light);
  });
  if (lights.length === 0) {
    const key = new THREE.DirectionalLight(0xffe8d0, 1.2);
    key.position.set(5, 8, 5);
    scene.add(key);
    activeLights.push(key);
  }

  (graph.objects || []).forEach(objDef => {
    const geom = geomFor(objDef.asset || "cube");
    const mat = makeMaterial(objDef);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.assetKey = objDef.asset || "cube";

    const [x, y, z] = objDef.location || [0, 0, 0];
    const [sx, sy, sz] = objDef.scale || [1, 1, 1];
    mesh.position.set(x, z, -y);
    mesh.scale.set(sx, sz, sy);

    mesh.userData.keyframes = (objDef.keyframes || []).map(kf => ({
      frame: kf.frame,
      rotation: kf.rotation ? [kf.rotation[0], kf.rotation[2], -kf.rotation[1]] : undefined,
      location: kf.location ? [kf.location[0], kf.location[2], -kf.location[1]] : undefined,
    }));
    mesh.userData.def = objDef;
    mesh.userData.isKaleidoCandidate = /^(ring|spiral)_/.test(objDef.name || "");

    // Stream 4: enable shadows. Planes/ground only receive, others cast+receive.
    const isGround = (objDef.asset === "plane") || /^(ground|floor)/.test(objDef.name || "");
    mesh.castShadow = !isGround;
    mesh.receiveShadow = true;

    scene.add(mesh);
    dynamicObjects.push(mesh);
  });

  const camKeys = (graph.camera?.keyframes || []).map(kf => ({
    frame: kf.frame,
    location: kf.location ? [kf.location[0], kf.location[2], -kf.location[1]] : [10, 5, 10],
    look_at: kf.look_at ? [kf.look_at[0], kf.look_at[2], -kf.look_at[1]] : [0, 0, 0],
  }));
  currentScene = { ...graph, _camKeys: camKeys };

  resetView();

  const objCount = (graph.objects || []).length;
  const lightCount = lights.length;
  els.sceneCount.textContent = `${objCount} objects · ${lightCount} lights`;
  els.sceneGraphPre.textContent = JSON.stringify(graph, null, 2);

  setMode(state.mode);
}

function enableKaleido(segments = 6) {
  // Try the shader-based kaleido first (realistic, chromatic dispersion).
  if (!kaleidoEffect && composer && window.__renderBackend !== "webgpu") {
    try {
      kaleidoEffect = new KaleidoEffect({
        segments,
        width: els.holder.clientWidth,
        height: els.holder.clientHeight,
      });
      // Insert before OutputPass if we can find it; else append.
      const passes = composer.passes;
      const outIdx = passes.findIndex(p => p.constructor && p.constructor.name === "OutputPass");
      if (outIdx > 0) {
        composer.insertPass(kaleidoEffect.pass, outIdx);
      } else {
        composer.addPass(kaleidoEffect.pass);
      }
      window.__kaleidoEffect = kaleidoEffect;
      return;
    } catch (e) {
      console.warn("[kaleido] shader path unavailable, using clones", e);
      kaleidoEffect = null;
    }
  }

  // Clone-based fallback (original implementation).
  kaleidoClones.forEach(c => { scene.remove(c); disposeMesh(c); });
  kaleidoClones = [];
  const candidates = dynamicObjects.filter(m => m.userData.isKaleidoCandidate);
  if (candidates.length === 0) return;
  for (let seg = 1; seg < segments; seg++) {
    const angle = (seg / segments) * Math.PI * 2;
    candidates.forEach(original => {
      const clone = new THREE.Mesh(original.geometry, original.material.clone());
      clone.userData.baseClone = { original, angle };
      clone.castShadow = original.castShadow;
      clone.receiveShadow = original.receiveShadow;
      scene.add(clone);
      kaleidoClones.push(clone);
    });
  }
}

function disableKaleido() {
  if (kaleidoEffect && composer) {
    try { composer.removePass(kaleidoEffect.pass); } catch (_) {}
    kaleidoEffect.dispose?.();
    kaleidoEffect = null;
    window.__kaleidoEffect = null;
  }
  kaleidoClones.forEach(c => { scene.remove(c); disposeMesh(c); });
  kaleidoClones = [];
}

function updateKaleidoClones() {
  if (kaleidoEffect) {
    const rot = kaleidoEffect.uniforms.get("rotation");
    if (rot) rot.value = clock.getElapsedTime() * 0.15;
    return;
  }
  kaleidoClones.forEach(clone => {
    const { original, angle } = clone.userData.baseClone;
    const x = original.position.x * Math.cos(angle) - original.position.z * Math.sin(angle);
    const z = original.position.x * Math.sin(angle) + original.position.z * Math.cos(angle);
    clone.position.set(x, original.position.y, z);
    clone.rotation.copy(original.rotation);
    clone.rotation.y += angle;
    clone.scale.copy(original.scale);
  });
}

// Exposed hook for a "Depth" toolbar slider. Clamped 0.2 - 3.0. Higher = more
// pronounced pop-out / off-axis frustum shear.
window.setDepthIntensity = (v) => {
  const n = Math.max(0.2, Math.min(4.0, Number(v) || 2.0));
  state.depthIntensity = n;
};

// UI hook for Stream 10 scale slider to adjust segment count live.
window.setKaleidoSegments = (n) => {
  state.kaleidoSegments = Math.max(2, Math.min(32, n | 0));
  if (kaleidoEffect) {
    const u = kaleidoEffect.uniforms.get("segments");
    if (u) u.value = state.kaleidoSegments;
  } else if (state.mode === "kaleido") {
    disableKaleido();
    enableKaleido(state.kaleidoSegments);
  }
};

function lerp(a, b, t) { return a + (b - a) * t; }

function interpKeyframes(kfs, t01) {
  if (!kfs || kfs.length === 0) return null;
  if (kfs.length === 1) return kfs[0];
  const frames = kfs.map(k => k.frame);
  const minF = Math.min(...frames);
  const maxF = Math.max(...frames);
  const currentFrame = minF + t01 * (maxF - minF);

  let before = kfs[0], after = kfs[kfs.length - 1];
  for (let i = 0; i < kfs.length - 1; i++) {
    if (currentFrame >= kfs[i].frame && currentFrame <= kfs[i + 1].frame) {
      before = kfs[i]; after = kfs[i + 1]; break;
    }
  }
  const span = after.frame - before.frame || 1;
  const t = (currentFrame - before.frame) / span;
  const out = {};
  ["rotation", "location"].forEach(key => {
    if (before[key] && after[key]) out[key] = before[key].map((v, i) => lerp(v, after[key][i], t));
    else if (before[key]) out[key] = [...before[key]];
    else if (after[key]) out[key] = [...after[key]];
  });
  return out;
}

function resetView() {
  controls.target.set(0, 0, 0);
  camera.position.set(10, 6, 10);
  controls.update();
}

async function setMode(mode) {
  state.mode = mode;
  els.modeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.mode === mode));
  els.viewerHint.style.opacity = mode === "orbit" ? "0.8" : "0.4";

  // Dispose splat viewer when leaving splat mode.
  if (mode !== "splat" && splatHandle) {
    try { splatHandle.dispose(); } catch (_) {}
    splatHandle = null;
  }

  // Dispose projection-mapping mode when leaving.
  if (mode !== "project" && projectionHandle) {
    try { projectionHandle.dispose(); } catch (_) {}
    projectionHandle = null;
    document.getElementById("projection-calibration")?.classList.remove("active");
    document.getElementById("projection-stepper")?.setAttribute("hidden", "");
    document.getElementById("surface-video-picker")?.classList.add("hidden");
    document.getElementById("surface-list-panel")?.setAttribute("hidden", "");
  }

  if (mode === "kaleido") {
    enableKaleido(state.kaleidoSegments);
    controls.autoRotate = true;
    controls.enabled = true;
  } else {
    disableKaleido();
    controls.autoRotate = false;
  }

  if (mode === "tour") {
    controls.enabled = false;
    state.tourT = 0;
  } else if (mode === "splat") {
    controls.autoRotate = false;
    controls.enabled = true;
    try {
      splatHandle = await mountSplatViewer({
        scene, camera, renderer, controls,
        url: SAMPLE_SPLATS.garden,
      });
    } catch (e) {
      console.warn("[splat] mount failed", e);
      showError("Splat viewer failed to load. Staying in orbit mode.");
      state.mode = "orbit";
    }
  } else if (mode === "project") {
    controls.autoRotate = false;
    controls.enabled = true;
    try {
      projectionHandle = new ProjectionMode();
      await projectionHandle.init({ scene, camera, renderer, composer, holder: els.holder });
      await projectionHandle.setSource("scene");
      projectionHandle.mountCornerUI(els.holder, null);
      document.getElementById("projection-calibration")?.classList.add("active");
      document.getElementById("projection-stepper")?.removeAttribute("hidden");
      setProjectionStep("camera");
      renderSurfaceList();
    } catch (e) {
      console.warn("[projection] mount failed", e);
      showError("Projection mapping failed to load: " + (e?.message || e));
      projectionHandle?.dispose?.();
      projectionHandle = null;
      state.mode = "orbit";
    }
  } else if (mode !== "kaleido") {
    controls.enabled = true;
    resetView();
  }
}

function tickFlythrough(dt) {
  if (!currentScene?._camKeys || currentScene._camKeys.length < 2) return;
  state.tourT += dt / state.tourDuration;
  if (state.tourT >= 1) state.tourT = 0;

  const interp = interpKeyframes(currentScene._camKeys, state.tourT);
  if (interp?.location) camera.position.set(...interp.location);

  const frames = currentScene._camKeys.map(k => k.frame);
  const minF = Math.min(...frames);
  const maxF = Math.max(...frames);
  const currentFrame = minF + state.tourT * (maxF - minF);
  let bKey = currentScene._camKeys[0], aKey = currentScene._camKeys[currentScene._camKeys.length - 1];
  for (let i = 0; i < currentScene._camKeys.length - 1; i++) {
    if (currentFrame >= currentScene._camKeys[i].frame && currentFrame <= currentScene._camKeys[i + 1].frame) {
      bKey = currentScene._camKeys[i]; aKey = currentScene._camKeys[i + 1]; break;
    }
  }
  const span = aKey.frame - bKey.frame || 1;
  const t = (currentFrame - bKey.frame) / span;
  const lookAt = bKey.look_at.map((v, i) => lerp(v, aKey.look_at[i], t));
  camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
}

// Parallax (fallback — disabled when POV head-tracking is active)
els.holder.addEventListener("pointermove", (e) => {
  if (povActive || state.mode === "tour") return;
  const rect = els.holder.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  state.parallax.tx = (nx - 0.5) * 2;
  state.parallax.ty = (ny - 0.5) * 2;
});
els.holder.addEventListener("pointerleave", () => {
  state.parallax.tx = 0; state.parallax.ty = 0;
});

if (window.DeviceOrientationEvent) {
  window.addEventListener("deviceorientation", (e) => {
    if (povActive || state.mode === "tour" || !e.beta || !e.gamma) return;
    state.parallax.tx = Math.max(-1, Math.min(1, e.gamma / 30));
    state.parallax.ty = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
  });
}

// Animation loop
const clock = new THREE.Clock();
let fpsSamples = [];

// FPS tracking + tracker-status pill polling. We update once per second so
// the DOM mutation doesn't itself drag down frame rate. Numbers are
// computed against an EMA-smoothed dt to avoid the jitter that a raw
// 1/dt readout would show.
let _fpsEma = 60;
function _updateTrackerStatusPill() {
  const el = document.getElementById("tracker-status");
  if (!el) return;
  el.hidden = false;
  const fpsEl = document.getElementById("ts-fps");
  if (fpsEl) fpsEl.textContent = `${Math.round(_fpsEma)} fps`;
  const setIcon = (tr, on) => {
    const i = el.querySelector(`[data-tr="${tr}"]`);
    if (!i) return;
    i.dataset.on = on ? "1" : "0";
  };
  const faceOn = (povSource === "face" || povSource === "gaze") && !!headTracker;
  const gazeOn = povSource === "gaze" && !!headTracker;
  const handOn = povSource === "hand" && !!handTracker;
  setIcon("face", faceOn);
  setIcon("hand", handOn);
  setIcon("gaze", gazeOn);
}
setInterval(_updateTrackerStatusPill, 1000);

function animate() {
  const dt = clock.getDelta();
  // 1€-like EMA on FPS — α=0.1 gives a half-second smoothing window.
  const instantFps = dt > 0 ? 1 / dt : 60;
  _fpsEma = _fpsEma * 0.9 + instantFps * 0.1;

  state.animT += dt / state.animDuration;
  if (state.animT >= 1) state.animT = 0;

  dynamicObjects.forEach(mesh => {
    const kfs = mesh.userData.keyframes;
    if (!kfs || kfs.length === 0) return;
    const interp = interpKeyframes(kfs, state.animT);
    if (interp?.rotation) mesh.rotation.set(...interp.rotation);
    if (interp?.location) mesh.position.set(...interp.location);
  });

  if (state.mode === "kaleido") {
    updateKaleidoClones();
    const pulse = 0.8 + 0.6 * Math.sin(clock.elapsedTime * 2);
    dynamicObjects.forEach(m => {
      if (m.material?.emissiveIntensity !== undefined) m.material.emissiveIntensity = pulse;
    });
  }

  if (state.mode === "tour") {
    tickFlythrough(dt);
  } else if (!povActive) {
    state.parallax.x += (state.parallax.tx - state.parallax.x) * 0.08;
    state.parallax.y += (state.parallax.ty - state.parallax.y) * 0.08;
    // Pop-out parallax: scale by depthIntensity. 0.15→0.38 at default 1.4.
    const pm = 0.27 * state.depthIntensity;
    camera.position.x += state.parallax.x * pm;
    camera.position.y -= state.parallax.y * pm;
    controls.update();
  } else {
    controls.update();
  }

  // Off-axis frustum — "window into a world" effect. Real head-tracking when
  // POV is active; otherwise synthesize a fake pose from mouse parallax so
  // geometry feels like it's popping out even without a webcam.
  const popOutOk = !["splat", "project", "tour"].includes(state.mode);
  // Pick the active pose source: face, hand, or fall back to mouse-synth.
  let realPose = null;
  if (povSource === "face" && headTracker) realPose = headTracker.getHeadPose();
  else if (povSource === "hand" && handTracker) realPose = handTracker.getPose();
  // Gaze mode: head pose blended with iris-derived gaze offset (see
  // head_tracking.js#getCombinedPose). Produces the strongest "look around
  // the corner" illusion on the Epson stereo output.
  else if (povSource === "gaze" && headTracker) realPose = headTracker.getCombinedPose({ gain: 0.10 });
  else if (povActive && headTracker) realPose = headTracker.getHeadPose(); // legacy POV button
  if (realPose && realPose.confidence > 0.4) {
    const k = 0.5 * state.depthIntensity;
    applyOffAxisProjection(camera, realPose, { w: k, h: k * 0.56 });
  } else if (popOutOk) {
    // Synthesize a head pose from smoothed mouse parallax so the world leans
    // toward the user even without a webcam. Z is driven by the MAGNITUDE of
    // mouse offset — mouse near centre = neutral; mouse pulled far = "leaning
    // in" = stronger pop-out.
    const mag = Math.hypot(state.parallax.x, state.parallax.y);
    const fakePose = {
      x: state.parallax.x * 0.08 * state.depthIntensity,
      y: state.parallax.y * 0.05 * state.depthIntensity,
      // Z proximity: 1.0 neutral, up to 1.6 when mouse pulled out. Synth Z
      // keeps pop-out breathing even if the user isn't moving the mouse.
      z: 1.0 + mag * 0.6,
      confidence: 1,
    };
    const k = 0.55 * state.depthIntensity;
    applyOffAxisProjection(camera, fakePose, { w: k, h: k * 0.56 });
  } else if (baseProjectionMatrix) {
    camera.projectionMatrix.copy(baseProjectionMatrix);
    camera.projectionMatrixInverse.copy(baseProjectionMatrix).invert();
  }

  if (stereoOutput && stereoOutput.mode !== "off") {
    // Stereo 3D output bypasses the composer — render scene twice with the
    // kaleido / lighting / scale still applied via plain `scene` geometry.
    // (Post-FX like bloom/SMAA are skipped in stereo mode for performance and
    // correctness — they'd differ per eye otherwise.)
    stereoOutput.render(scene, camera);
  } else if (state.mode === "splat" && splatHandle) {
    splatHandle.tick();
  } else if (state.mode === "project" && projectionHandle) {
    projectionHandle.tick();
  } else {
    composer.render();
  }

  const fps = 1 / (dt || 0.016);
  fpsSamples.push(fps);
  if (fpsSamples.length > 30) fpsSamples.shift();
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  els.fps.textContent = `${avg.toFixed(0)} fps · ${dynamicObjects.length + kaleidoClones.length} meshes`;

  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Default demo scene
// ---------------------------------------------------------------------------
function makeDefaultScene() {
  return {
    camera: { lens: 35, keyframes: [
      { frame: 1,  location: [10, 0, 5], look_at: [0, 0, 0] },
      { frame: 36, location: [-8, 6, 6], look_at: [0, 0, 0] },
      { frame: 72, location: [10, 0, 5], look_at: [0, 0, 0] },
    ]},
    lights: [
      { type: "AREA", location: [4, -4, 6], energy: 1200, size: 4, color: [1, 0.95, 0.85] },
      { type: "POINT", location: [-5, 3, 4], energy: 800, color: [0.6, 0.3, 0.95] },
      { type: "POINT", location: [0, 5, -3], energy: 600, color: [0.2, 0.8, 0.95] },
    ],
    objects: [
      { name: "hero", asset: "torus", location: [0, 0, 0], scale: [1.4, 1.4, 1.4],
        color: [0.9, 0.3, 0.75, 1.0], metallic: 0.8, roughness: 0.15,
        emissive: [0.15, 0.05, 0.12],
        keyframes: [{ frame: 1, rotation: [0, 0, 0] }, { frame: 72, rotation: [6.28, 3.14, 6.28] }] },
      ...Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const x = 5.5 * Math.cos(a);
        const y = 5.5 * Math.sin(a);
        const z = 0.5 * Math.sin(a * 3);
        const palette = [[0.6, 0.2, 0.9], [0.2, 0.4, 0.95], [0.9, 0.3, 0.7], [0.1, 0.85, 0.95]];
        const col = palette[i % 4];
        return {
          name: `ring_${i}`, asset: "sphere", location: [x, y, z],
          scale: [0.6, 0.6, 0.6], color: [...col, 1.0],
          metallic: 0.7, roughness: 0.2, emissive: col.map(c => c * 0.15),
          keyframes: [
            { frame: 1,  rotation: [0, 0, a], location: [x, y, z] },
            { frame: 72, rotation: [6.28, 0, a + 6.28], location: [x, y, z + Math.sin(a)] },
          ],
        };
      }),
    ],
    world: { background: [0.02, 0.02, 0.04], fog_density: 0.015 },
    frame_count: 72, fps: 24,
  };
}

// ---------------------------------------------------------------------------
// Backend helpers
// ---------------------------------------------------------------------------
function setStatus(kind, text) {
  els.statusPill.className = "status-pill " + (kind === "err" ? "err" : kind === "warm" ? "warm" : "");
  els.statusPill.querySelector(".label").textContent = text;
}
function showError(msg) { els.errorBox.textContent = msg; els.errorBox.classList.add("visible"); }
function clearError() { els.errorBox.classList.remove("visible"); }
function showProgress(pct, text) {
  els.progress.classList.add("active");
  els.progressBar.style.width = Math.max(pct, 3) + "%";
  els.progressLabel.textContent = text || "Rendering MP4…";
}
function hideProgress() { els.progress.classList.remove("active"); }

async function probeBackend() {
  if (!BACKEND) { setStatus("err", "Backend not configured"); return; }
  setStatus("checking", "Connecting…");
  try {
    const t0 = Date.now();
    const res = await fetch(`${BACKEND}/health`);
    const dt = Date.now() - t0;
    setStatus(res.ok ? "ok" : "warm", res.ok ? `Backend ready · ${dt}ms` : `HTTP ${res.status}`);
  } catch (e) {
    setStatus("warm", "Backend cold-starting…");
  }
}

function prettyStage(stage) {
  const m = {
    queued: "Queued…", scene_ready: "Scene ready · launching Blender",
    rendering_frames: "Rendering frames…", composing_video: "Stitching video…",
    complete: "Done!", error: "Failed",
  };
  if (m[stage]) return m[stage];
  if (stage?.startsWith("rendering ")) return `Rendering ${stage.replace("rendering ", "")}…`;
  return stage || "Working…";
}

// ---------------------------------------------------------------------------
// Director panel
// ---------------------------------------------------------------------------
// Currently selected palette name — picked from the Palette pill. "auto" lets
// the backend keyword-match from the prompt (legacy behavior).
let currentPalette = "auto";

function collectDirection() {
  const base = { palette: currentPalette === "auto" ? null : currentPalette };
  if (els.aiDirect.checked) return { ...base, ai_direct: true };
  return {
    ...base,
    shot: els.shotSel.value,
    lighting: els.lightingSel.value,
    mood: els.moodSel.value,
    pace: els.paceSel.value,
  };
}

function applyAiDirectLock() {
  const locked = els.aiDirect.checked;
  els.manualControls.classList.toggle("locked", locked);
  els.directorHint.textContent = locked
    ? "AI Direct — Claude interprets everything"
    : `Manual · ${els.shotSel.value} · ${els.lightingSel.value} · ${els.moodSel.value} · ${els.paceSel.value}`;
}
els.aiDirect.addEventListener("change", applyAiDirectLock);
[els.shotSel, els.lightingSel, els.moodSel, els.paceSel].forEach(sel => sel.addEventListener("change", applyAiDirectLock));

// ---------------------------------------------------------------------------
// Photo upload
// ---------------------------------------------------------------------------
function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showError("Please drop an image file");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    currentPhotoData = reader.result;
    els.photoPreview.src = reader.result;
    els.photoPreview.classList.remove("hidden");
    els.photoGenerate.classList.remove("hidden");
    clearError();
  };
  reader.readAsDataURL(file);
}

els.dropZone.addEventListener("click", (e) => {
  if (e.target.tagName !== "IMG") els.photoInput.click();
});
els.photoInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});
["dragenter", "dragover"].forEach(ev => {
  els.dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropZone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach(ev => {
  els.dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("dragover");
  });
});
els.dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

els.photoGenerate.addEventListener("click", () => {
  if (!currentPhotoData) return;
  generateFromImage(currentPhotoData);
});

// ---------------------------------------------------------------------------
// Director AI Q&A
// ---------------------------------------------------------------------------
let qaContext = null;  // { prompt, questions, answers }

function showQA(prompt, questions) {
  qaContext = { prompt, questions, answers: {} };
  els.qaBody.innerHTML = "";
  questions.forEach(q => {
    const wrap = document.createElement("div");
    wrap.className = "qa-question";
    const text = document.createElement("div");
    text.className = "q-text";
    text.textContent = q.text;
    wrap.appendChild(text);
    const opts = document.createElement("div");
    opts.className = "qa-options";
    (q.options || []).forEach(opt => {
      const b = document.createElement("button");
      b.className = "qa-option";
      b.textContent = opt;
      b.type = "button";
      b.addEventListener("click", () => {
        [...opts.children].forEach(c => c.classList.remove("selected"));
        b.classList.add("selected");
        qaContext.answers[q.id] = opt;
      });
      opts.appendChild(b);
    });
    wrap.appendChild(opts);
    els.qaBody.appendChild(wrap);
  });
  els.directQuestions.classList.remove("hidden");
  els.directorDetails.open = true;
}

els.qaSubmit.addEventListener("click", async () => {
  if (!qaContext) return;
  els.directQuestions.classList.add("hidden");
  const direction = await fetchDirection(qaContext.prompt, qaContext.answers);
  qaContext = null;
  if (direction) runGenerate(qaContext?.prompt || els.prompt.value.trim(), direction);
  else runGenerate(els.prompt.value.trim(), collectDirection());
});

els.qaSkip.addEventListener("click", () => {
  els.directQuestions.classList.add("hidden");
  const prompt = qaContext?.prompt || els.prompt.value.trim();
  qaContext = null;
  runGenerate(prompt, collectDirection());
});

async function fetchDirection(prompt, answers = null) {
  try {
    const res = await fetch(`${BACKEND}/direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, answers }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === "questions" && data.questions?.length) {
      showQA(prompt, data.questions);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generate (prompt path)
// ---------------------------------------------------------------------------
async function runGenerate(prompt, direction) {
  clearError();
  els.downloadBtn.classList.add("hidden");
  els.submit.disabled = true;
  els.submit.textContent = "Working…";
  showProgress(3, "Building scene…");

  const t0 = Date.now();
  const elapsedTimer = setInterval(() => {
    els.progressElapsed.textContent = ((Date.now() - t0) / 1000).toFixed(1) + "s";
  }, 100);

  try {
    const res = await fetch(`${BACKEND}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, direction }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Backend ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();

    if (data.scene_graph) {
      buildScene(data.scene_graph);
      currentSceneMeta = {
        render_id: data.render_id,
        prompt,
        scene_graph: data.scene_graph,
        status: "pending",
        progress: 0,
        created_at: Date.now(),
      };
      showProgress(10, "Scene built · rendering MP4 in background");
      setStatus("ok", `Scene ready · ${(data.scene_graph.objects || []).length} objects`);
    }
    els.submit.disabled = false;
    els.submit.textContent = "Generate";

    // Poll render
    const renderId = data.render_id;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      let statusData;
      try {
        const r = await fetch(`${BACKEND}/status/${renderId}`);
        if (!r.ok) continue;
        statusData = await r.json();
      } catch { continue; }

      showProgress(statusData.progress || 10, prettyStage(statusData.stage));

      // Update the storyboard entry live
      const scene = storyboard.find(s => s.render_id === renderId);
      if (scene) {
        scene.status = statusData.status;
        scene.progress = statusData.progress;
        if (statusData.video_url) scene.video_url = `${BACKEND}${statusData.video_url}`;
        saveStoryboard();
        renderStoryboardUI();
      }
      if (currentSceneMeta?.render_id === renderId) {
        currentSceneMeta.status = statusData.status;
        currentSceneMeta.progress = statusData.progress;
        if (statusData.video_url) currentSceneMeta.video_url = `${BACKEND}${statusData.video_url}`;
      }

      if (statusData.status === "complete") {
        els.downloadBtn.href = `${BACKEND}${statusData.video_url}`;
        els.downloadBtn.classList.remove("hidden");
        showProgress(100, `Done · ${(statusData.render_ms / 1000).toFixed(1)}s render`);
        setTimeout(hideProgress, 2000);
        clearInterval(elapsedTimer);
        return;
      }
      if (statusData.status === "failed") {
        clearInterval(elapsedTimer);
        hideProgress();
        showError(`MP4 render failed: ${statusData.error || "unknown"} (scene still interactive)`);
        return;
      }
    }
    clearInterval(elapsedTimer);
    showError("MP4 render timed out (interactive scene still available)");
  } catch (e) {
    console.error(e);
    clearInterval(elapsedTimer);
    hideProgress();
    showError(e.message || "Something went wrong");
    setStatus("err", "Backend error");
    els.submit.disabled = false;
    els.submit.textContent = "Generate";
  }
}

async function generate(prompt) {
  const direction = collectDirection();
  // If AI Direct and prompt is short, ask Claude if it needs clarification
  if (direction.ai_direct && prompt.split(/\s+/).length < 4) {
    const d = await fetchDirection(prompt, null);
    if (d === null) return; // Q&A shown, will call runGenerate later
    runGenerate(prompt, d);
  } else {
    runGenerate(prompt, direction);
  }
}

async function generateFromImage(imageData) {
  clearError();
  els.downloadBtn.classList.add("hidden");
  els.submit.disabled = true;
  showProgress(3, "Analyzing photo…");
  const t0 = Date.now();
  const elapsedTimer = setInterval(() => {
    els.progressElapsed.textContent = ((Date.now() - t0) / 1000).toFixed(1) + "s";
  }, 100);

  try {
    const direction = collectDirection();
    const prompt_hint = els.prompt.value.trim();
    const res = await fetch(`${BACKEND}/generate-from-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageData, direction, prompt_hint }),
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    if (data.scene_graph) {
      buildScene(data.scene_graph);
      currentSceneMeta = {
        render_id: data.render_id,
        prompt: prompt_hint || "[from photo]",
        scene_graph: data.scene_graph,
        status: "pending",
        progress: 0,
        from_image: true,
        created_at: Date.now(),
      };
      setStatus("ok", `Scene from photo · ${(data.scene_graph.objects || []).length} objects`);
      showProgress(10, "Scene built · rendering MP4");
    }
    els.submit.disabled = false;

    // Poll
    const renderId = data.render_id;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const r = await fetch(`${BACKEND}/status/${renderId}`);
        if (!r.ok) continue;
        const sd = await r.json();
        showProgress(sd.progress || 10, prettyStage(sd.stage));
        if (currentSceneMeta?.render_id === renderId) {
          currentSceneMeta.status = sd.status;
          currentSceneMeta.progress = sd.progress;
          if (sd.video_url) currentSceneMeta.video_url = `${BACKEND}${sd.video_url}`;
        }
        if (sd.status === "complete") {
          els.downloadBtn.href = `${BACKEND}${sd.video_url}`;
          els.downloadBtn.classList.remove("hidden");
          showProgress(100, `Done · ${(sd.render_ms / 1000).toFixed(1)}s`);
          setTimeout(hideProgress, 2000);
          clearInterval(elapsedTimer);
          return;
        }
        if (sd.status === "failed") {
          clearInterval(elapsedTimer);
          hideProgress();
          showError(`Render failed: ${sd.error || "unknown"}`);
          return;
        }
      } catch {}
    }
    clearInterval(elapsedTimer);
  } catch (e) {
    console.error(e);
    clearInterval(elapsedTimer);
    hideProgress();
    showError(e.message);
    els.submit.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Storyboard
// ---------------------------------------------------------------------------
let storyboard = [];

function loadStoryboard() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    storyboard = s ? JSON.parse(s) : [];
  } catch {
    storyboard = [];
  }
  renderStoryboardUI();
}
function saveStoryboard() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(storyboard)); } catch {}
}

function renderStoryboardUI() {
  if (storyboard.length === 0) {
    els.storyboardList.innerHTML = `<div class="storyboard-empty">Empty. Generate scenes and click "+ Add to film" to build a sequence.</div>`;
    els.compileFilm.disabled = true;
    return;
  }
  els.compileFilm.disabled = false;
  els.storyboardList.innerHTML = "";
  storyboard.forEach((scene, idx) => {
    const card = document.createElement("div");
    card.className = "scene-card";
    card.draggable = true;
    card.dataset.idx = idx;

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (scene.video_url && scene.status === "complete") {
      const v = document.createElement("video");
      v.src = scene.video_url + "#t=0.5";
      v.muted = true;
      v.preload = "metadata";
      thumb.innerHTML = "";
      thumb.appendChild(v);
    } else {
      thumb.textContent = "🎬";
    }
    card.appendChild(thumb);

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = scene.prompt || "Untitled scene";
    card.appendChild(title);

    const status = document.createElement("div");
    status.className = "status " + (scene.status || "pending");
    if (scene.status === "complete") status.textContent = "✓ Ready";
    else if (scene.status === "failed") status.textContent = "✗ Failed";
    else status.textContent = `${scene.progress || 0}% rendering`;
    card.appendChild(status);

    const remove = document.createElement("button");
    remove.className = "remove-btn";
    remove.textContent = "×";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      storyboard.splice(idx, 1);
      saveStoryboard();
      renderStoryboardUI();
    });
    card.appendChild(remove);

    // Drag handlers
    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", idx);
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (e) => e.preventDefault());
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = +e.dataTransfer.getData("text/plain");
      const to = idx;
      if (from !== to) {
        const [moved] = storyboard.splice(from, 1);
        storyboard.splice(to, 0, moved);
        saveStoryboard();
        renderStoryboardUI();
      }
    });

    els.storyboardList.appendChild(card);
  });
}

els.addToStoryboard.addEventListener("click", () => {
  if (!currentSceneMeta) {
    showError("Generate a scene first");
    return;
  }
  // Avoid duplicate
  if (storyboard.some(s => s.render_id === currentSceneMeta.render_id)) {
    return;
  }
  storyboard.push({ ...currentSceneMeta });
  saveStoryboard();
  renderStoryboardUI();
});

els.clearStoryboard.addEventListener("click", () => {
  if (!confirm("Clear the storyboard?")) return;
  storyboard = [];
  saveStoryboard();
  renderStoryboardUI();
  els.filmResult.classList.add("hidden");
});

// Film compiler
els.compileFilm.addEventListener("click", async () => {
  const pending = storyboard.filter(s => s.status !== "complete");
  if (pending.length > 0) {
    showError(`${pending.length} scene(s) still rendering. Wait for them to finish first.`);
    return;
  }
  const readyIds = storyboard.filter(s => s.status === "complete").map(s => s.render_id);
  if (readyIds.length === 0) {
    showError("No completed scenes to compile");
    return;
  }

  els.compileFilm.disabled = true;
  els.compileFilm.textContent = "Compiling…";
  els.filmProgress.textContent = "Submitting film compilation…";

  try {
    const res = await fetch(`${BACKEND}/compile-film`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ render_ids: readyIds, transition: "cut" }),
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    const filmId = data.film_id;

    // Poll
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const r = await fetch(`${BACKEND}/film-status/${filmId}`);
      if (!r.ok) continue;
      const sd = await r.json();
      els.filmProgress.textContent = `Compiling · ${sd.progress}%`;
      if (sd.status === "complete") {
        const url = `${BACKEND}${sd.video_url}`;
        els.finalFilm.src = url;
        els.filmDownload.href = url;
        els.filmResult.classList.remove("hidden");
        els.filmMetaLabel.textContent = `${readyIds.length} scenes · compiled film`;
        els.filmProgress.textContent = "";
        break;
      }
      if (sd.status === "failed") {
        showError(`Film compile failed: ${sd.error || "unknown"}`);
        els.filmProgress.textContent = "";
        break;
      }
    }
  } catch (e) {
    showError(e.message);
    els.filmProgress.textContent = "";
  } finally {
    els.compileFilm.disabled = false;
    els.compileFilm.textContent = "🎬 Compile Film";
  }
});

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
els.submit.addEventListener("click", () => {
  const p = els.prompt.value.trim();
  if (!p) { showError("Please enter a prompt."); return; }
  generate(p);
});
els.prompt.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.submit.click();
});
els.exampleChips.forEach(chip => {
  chip.addEventListener("click", () => {
    els.prompt.value = chip.textContent.trim();
    els.submit.click();
  });
});
els.modeBtns.forEach(btn => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});
els.resetView.addEventListener("click", resetView);

// ---------------------------------------------------------------------------
// Stream 10: toolbar wiring (quality / HDRI / scale / kaleido intensity / POV)
// ---------------------------------------------------------------------------
function wireToolbar() {
  const qpill = document.getElementById("quality-pill");
  if (qpill) qpill.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-q]"); if (!btn) return;
    qpill.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    window.setQuality?.(btn.dataset.q);
  });
  const hpill = document.getElementById("hdri-pill");
  if (hpill) hpill.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-h]"); if (!btn) return;
    hpill.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    window.loadHDRI?.(btn.dataset.h);
  });
  const ppill = document.getElementById("palette-pill");
  if (ppill) ppill.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-p]"); if (!btn) return;
    ppill.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    currentPalette = btn.dataset.p;
  });
  const spill = document.getElementById("stereo-pill");
  if (spill) spill.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-s]"); if (!btn || !stereoOutput) return;
    spill.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    stereoOutput.setMode(btn.dataset.s);
    setStatus("ok", `3D output: ${btn.dataset.s.toUpperCase()}`);
  });
  const ppovPill = document.getElementById("pov-pill");
  if (ppovPill) ppovPill.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-pov]"); if (!btn) return;
    const src = btn.dataset.pov;
    setStatus("warm", `POV → ${src}…`);
    const r = await window.setPovSource?.(src);
    if (!r?.ok) {
      setStatus("err", `POV ${src} failed: ${r?.error || ""}`);
      return;
    }
    ppovPill.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    setStatus("ok", src === "off" ? "POV off" : `POV: ${src}`);
  });
  const scale = document.getElementById("scene-scale");
  const scaleVal = document.getElementById("scene-scale-val");
  if (scale) scale.addEventListener("input", () => {
    const v = parseFloat(scale.value);
    if (scaleVal) scaleVal.textContent = v.toFixed(2) + "×";
    const root = (window.__sceneRoot) || (typeof scene !== "undefined" ? scene : null);
    if (root) root.scale.setScalar(v);
  });
  const kal = document.getElementById("kaleido-intensity");
  const kalVal = document.getElementById("kaleido-intensity-val");
  if (kal) kal.addEventListener("input", () => {
    const v = parseInt(kal.value, 10);
    if (kalVal) kalVal.textContent = v + "-fold";
    window.setKaleidoSegments?.(v);
  });
  const depth = document.getElementById("depth-intensity");
  const depthVal = document.getElementById("depth-intensity-val");
  if (depth) depth.addEventListener("input", () => {
    const v = parseFloat(depth.value);
    if (depthVal) depthVal.textContent = v.toFixed(2) + "×";
    window.setDepthIntensity?.(v);
  });
  const pov = document.getElementById("btn-pov");
  const povStatus = document.getElementById("pov-status");
  if (pov) pov.addEventListener("click", async () => {
    if (povActive) {
      window.disableHeadTracking?.();
      pov.classList.remove("active");
      if (povStatus) povStatus.textContent = "";
      return;
    }
    if (povStatus) povStatus.textContent = "Requesting camera…";
    const res = await window.enableHeadTracking?.();
    if (res?.ok) {
      pov.classList.add("active");
      if (povStatus) povStatus.textContent = "Tracking active — move your head.";
    } else {
      if (povStatus) povStatus.textContent = "Failed: " + (res?.error || "unknown");
    }
  });
  const calib = document.getElementById("pov-calibrate");
  if (calib) calib.addEventListener("click", () => {
    if (headTracker) headTracker.calibrate();
    if (povStatus) povStatus.textContent = "Calibrated.";
  });

  // Fullscreen — uses the Fullscreen API against the canvas holder so the
  // viewer fills the browser (and on supporting browsers, the monitor).
  const fs = els.fullscreenBtn || document.getElementById("btn-fullscreen");
  if (fs) fs.addEventListener("click", async () => {
    const target = els.holder;
    try {
      if (!document.fullscreenElement) {
        await (target.requestFullscreen?.() || target.webkitRequestFullscreen?.());
        fs.classList.add("active");
        fs.textContent = "🗗 Exit fullscreen";
      } else {
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
        fs.classList.remove("active");
        fs.textContent = "⛶ Fullscreen";
      }
    } catch (e) {
      console.warn("[fullscreen] failed", e);
      showError("Fullscreen not available in this browser.");
    }
  });
  const onFsChange = () => {
    // Resize is already handled by the ResizeObserver on window; nudge anyway
    // to pick up the new clientWidth/Height once fullscreen reflow completes.
    resize();
    const inFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (fs) {
      fs.classList.toggle("active", inFS);
      fs.textContent = inFS ? "🗗 Exit fullscreen" : "⛶ Fullscreen";
    }
  };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);

  // Projection-mapping controls.
  const srcBtns = document.querySelectorAll("#projection-calibration [data-proj-src]");
  srcBtns.forEach((btn) => btn.addEventListener("click", async () => {
    if (!projectionHandle) return;
    const src = btn.dataset.projSrc;
    try {
      if (src === "upload") {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*";
        input.onchange = async () => {
          if (input.files?.[0]) await projectionHandle.setSource("upload", input.files[0]);
        };
        input.click();
      } else {
        await projectionHandle.setSource(src);
      }
      srcBtns.forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    } catch (e) {
      showError("Projection source failed: " + (e?.message || e));
    }
  }));
  const detectBtn = document.getElementById("projection-detect");
  if (detectBtn) detectBtn.addEventListener("click", () => {
    if (!projectionHandle) return;
    try {
      const polys = projectionHandle.detectContours();
      projectionHandle.createSurfacesFromContours(polys.slice(0, 1));
    } catch (e) { showError("Contour detect failed: " + (e?.message || e)); }
  });
  const saveBtn = document.getElementById("projection-save");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    if (!projectionHandle) return;
    // Lazy-import the shared save_modal so Studio doesn't pull it in on
    // first paint (save is a rare action vs. the rest of the Studio).
    const { openSaveModal } = await import("./save_modal.js");
    const result = await openSaveModal({
      suggestedName: "untitled",
      saver: (name) => projectionHandle.saveToBackend(name, BACKEND),
    });
    if (result?.error) showError("Projection save failed: " + result.error);
  });
  const loadBtn = document.getElementById("projection-load");
  if (loadBtn) loadBtn.addEventListener("click", async () => {
    if (!projectionHandle) return;
    // Replace prompt() with an inline mini-modal that takes a UUID.
    const id = (await __askProjectId()) || "";
    if (!id) return;
    try {
      await projectionHandle.loadFromBackend(id, BACKEND);
      const { addProject } = await import("./recent_projects.js");
      addProject({ id, name: id, source: "loaded" });
      renderSurfaceList();
    }
    catch (e) { showError("Projection load failed: " + (e?.message || e)); }
  });

  // Lightweight inline async-prompt: shows a 1-input dialog using the
  // help-modal CSS shell. Resolves with the entered string or null.
  // Defined here to keep it scoped to the Studio's projection load.
  function __askProjectId() {
    return new Promise((resolve) => {
      // Pop the help modal mechanism — we just re-use its CSS class for free.
      let modal = document.getElementById("__ask-modal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "__ask-modal";
        modal.className = "help-modal hidden";
        modal.innerHTML = `
          <div class="help-modal-card" role="dialog" aria-label="Load project">
            <h2>Load project</h2>
            <p>Paste the project ID (UUID) you got when you saved this in the Mapper.</p>
            <input type="text" id="__ask-input" class="save-modal-input" placeholder="e.g. 6e90e6ef-d36c-4e18-..." style="width:100%;margin-bottom:14px" />
            <div class="save-modal-actions">
              <button class="primary" id="__ask-go">Load</button>
              <button class="secondary" id="__ask-cancel">Cancel</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
      const input = modal.querySelector("#__ask-input");
      input.value = "";
      const close = (val) => {
        modal.classList.add("hidden");
        resolve(val);
      };
      modal.classList.remove("hidden");
      setTimeout(() => input.focus(), 50);
      modal.querySelector("#__ask-go").onclick = () => close(input.value.trim());
      modal.querySelector("#__ask-cancel").onclick = () => close(null);
      modal.onclick = (e) => { if (e.target === modal) close(null); };
      input.onkeydown = (e) => {
        if (e.key === "Enter") close(input.value.trim());
        if (e.key === "Escape") close(null);
      };
    });
  }

  // --- v3 stepper: Start camera → Scan → Assign → Play ------------------
  const stepBtns = () => Array.from(document.querySelectorAll(".step-btn"));
  const setProjectionStepDom = (name) => {
    stepBtns().forEach((b) => {
      const step = b.dataset.step;
      b.classList.toggle("active", step === name);
    });
  };
  // Exposed for setMode() + loaders.
  window.__setProjectionStep = setProjectionStepDom;

  function markStepDone(step) {
    const btn = document.querySelector(`.step-btn[data-step="${step}"]`);
    if (btn) btn.classList.add("done");
    // Progressive unlock: once you reach each level, the tools for that level open up.
    if (step === "camera") {
      ["scan"].forEach(s => document.querySelector(`.step-btn[data-step="${s}"]`)?.removeAttribute("disabled"));
      setProjectionStepDom("scan");
    } else if (step === "scan") {
      ["detail", "draw", "randomize", "assign"].forEach(s => document.querySelector(`.step-btn[data-step="${s}"]`)?.removeAttribute("disabled"));
      setProjectionStepDom("assign");
    } else if (step === "assign") {
      ["play", "show"].forEach(s => document.querySelector(`.step-btn[data-step="${s}"]`)?.removeAttribute("disabled"));
      setProjectionStepDom("play");
    }
  }

  document.querySelectorAll(".step-btn").forEach((btn) => btn.addEventListener("click", async () => {
    if (!projectionHandle) return;
    const step = btn.dataset.step;
    btn.disabled = true;
    try {
      if (step === "camera") {
        await projectionHandle.setSource("webcam");
        markStepDone("camera");
      } else if (step === "scan") {
        setStatus("warm", "Scanning surfaces…");
        const polys = projectionHandle.detectSurfacesAI();
        if (!polys.length) { showError("No surfaces detected. Try better lighting or move closer."); btn.disabled = false; return; }
        projectionHandle.createSurfacesFromAI(polys);
        renderSurfaceList();
        setStatus("ok", `Detected ${polys.length} surface${polys.length === 1 ? "" : "s"}`);
        markStepDone("scan");
      } else if (step === "detail") {
        setStatus("warm", "Detail scanning…");
        const polys = projectionHandle.detectDetailedSurfaces();
        if (!polys.length) { showError("No detailed surfaces found."); btn.disabled = false; return; }
        projectionHandle.createSurfacesFromAI(polys);
        renderSurfaceList();
        setStatus("ok", `Detail: ${polys.length} surfaces`);
      } else if (step === "draw") {
        startDrawSurface(btn);
      } else if (step === "randomize") {
        setStatus("warm", "Assigning random presets…");
        await projectionHandle.randomizePresets();
        renderSurfaceList();
        setStatus("ok", "Randomized");
        if (!document.querySelector('.step-btn[data-step="assign"]')?.classList.contains("done")) markStepDone("assign");
      } else if (step === "assign") {
        markStepDone("assign");
      } else if (step === "play") {
        projectionHandle.playAll();
        markStepDone("play");
        setStatus("ok", "Playing all surfaces");
      } else if (step === "show") {
        toggleShowMode();
      }
    } catch (e) { showError(`Projection step '${step}' failed: ${e?.message || e}`); }
    finally { btn.disabled = false; }
  }));

  // --- Draw-a-surface tool (click 3+ points, double-click to close) -----
  let _drawing = null;
  function startDrawSurface(triggerBtn) {
    if (_drawing) return;
    _drawing = { points: [], triggerBtn, overlay: null };
    setStatus("warm", "Click 3+ points on canvas, double-click to close");
    // Add an SVG overlay for live preview of the polygon being drawn.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.cssText = "position:absolute; inset:0; pointer-events:none; z-index:25;";
    svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("fill", "rgba(92,204,255,0.18)");
    poly.setAttribute("stroke", "#5cf"); poly.setAttribute("stroke-width", "2");
    svg.appendChild(poly);
    els.holder.appendChild(svg);
    _drawing.overlay = svg; _drawing.polyEl = poly;
    els.holder.addEventListener("pointerdown", drawClick);
    els.holder.addEventListener("dblclick", drawFinish);
    document.body.style.cursor = "crosshair";
  }
  function drawClick(e) {
    if (!_drawing) return;
    // Ignore clicks on the stepper / surface list / modal — they sit above.
    if (e.target.closest(".projection-stepper, .surface-list-panel, .surface-video-picker, .viewer-controls")) return;
    const rect = els.holder.getBoundingClientRect();
    _drawing.points.push([e.clientX - rect.left, e.clientY - rect.top]);
    _drawing.polyEl.setAttribute("points", _drawing.points.map(p => p.join(",")).join(" "));
  }
  function drawFinish() {
    if (!_drawing || _drawing.points.length < 3) { cancelDraw(); return; }
    const rect = els.holder.getBoundingClientRect();
    const polyNdc = _drawing.points.map(([x, y]) => [
      (x / rect.width) * 2 - 1,
      -((y / rect.height) * 2 - 1),
    ]);
    projectionHandle.addManualSurface(polyNdc);
    renderSurfaceList();
    setStatus("ok", "Surface added");
    if (!document.querySelector('.step-btn[data-step="assign"]')?.classList.contains("done")) markStepDone("assign");
    cancelDraw();
  }
  function cancelDraw() {
    if (!_drawing) return;
    els.holder.removeEventListener("pointerdown", drawClick);
    els.holder.removeEventListener("dblclick", drawFinish);
    _drawing.overlay?.remove();
    _drawing = null;
    document.body.style.cursor = "";
  }

  // --- Show mode (pro presentation) ------------------------------------
  function toggleShowMode() {
    const on = !document.body.classList.contains("show-mode");
    document.body.classList.toggle("show-mode", on);
    const showBtn = document.querySelector('.step-btn[data-step="show"]');
    if (showBtn) showBtn.classList.toggle("active", on);
    if (on) {
      els.holder.requestFullscreen?.().catch(() => {});
      if (projectionHandle) projectionHandle.playAll();
    } else {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  }
  // Exit show mode on Escape is free via Fullscreen API's built-in behavior,
  // but we also remove the class in the fullscreenchange listener.

  // --- Keyboard shortcuts (project mode only) --------------------------
  document.addEventListener("keydown", (e) => {
    if (state.mode !== "project" || !projectionHandle) return;
    // Ignore while typing in inputs / textareas.
    if (e.target.matches("input, textarea, select") || e.target.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (k === " " || e.code === "Space") {
      e.preventDefault();
      const anyPlaying = projectionHandle.getSurfaces().some(s => s.source === "video" && projectionHandle.isPlaying(s.id));
      if (anyPlaying) projectionHandle.pauseAll(); else projectionHandle.playAll();
      renderSurfaceList();
    } else if (k === "s") { toggleShowMode(); }
    else if (k === "r") {
      document.querySelector('.step-btn[data-step="randomize"]')?.click();
    } else if (k === "d") {
      document.querySelector('.step-btn[data-step="detail"]')?.click();
    } else if (k === "f") {
      document.getElementById("btn-fullscreen")?.click();
    } else if (k === "escape") {
      if (_drawing) cancelDraw();
      if (document.body.classList.contains("show-mode")) toggleShowMode();
    }
  });

  // --- Raycaster: click / hover a surface in project mode ---------------
  const _ray = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  function ndcFromEvent(e) {
    const rect = els.holder.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }
  function raycastSurfaces(e) {
    if (state.mode !== "project" || !projectionHandle?.surfaces?.length) return null;
    ndcFromEvent(e);
    _ray.setFromCamera(_ndc, camera);
    const hits = _ray.intersectObjects(projectionHandle.surfaces, false);
    return hits[0]?.object || null;
  }
  els.holder.addEventListener("pointerdown", (e) => {
    const hit = raycastSurfaces(e);
    if (!hit) return;
    openVideoPicker(hit.userData.surfaceId);
  });
  els.holder.addEventListener("pointermove", (e) => {
    if (state.mode !== "project" || !projectionHandle) return;
    const hit = raycastSurfaces(e);
    document.body.style.cursor = hit ? "pointer" : "";
  });

  // --- Video picker modal -----------------------------------------------
  let _pickerSurfaceId = null;
  function openVideoPicker(surfaceId) {
    _pickerSurfaceId = surfaceId;
    const modal = document.getElementById("surface-video-picker");
    if (!modal) return;
    const title = document.getElementById("spv-title");
    const surfaces = projectionHandle?.getSurfaces?.() || [];
    const s = surfaces.find(x => x.id === surfaceId);
    if (title && s) title.textContent = `Pick a video for "${s.name}"`;
    // Render preset chips once (idempotent).
    const presetsEl = document.getElementById("spv-presets");
    if (presetsEl && !presetsEl.dataset.rendered) {
      presetsEl.innerHTML = PROJECTION_PRESETS.map(p =>
        `<button class="preset-chip" data-preset-id="${p.id}" data-preset-uri="${p.uri}">${p.name}</button>`
      ).join("");
      presetsEl.addEventListener("click", async (ev) => {
        const b = ev.target.closest("button[data-preset-uri]"); if (!b) return;
        try {
          await projectionHandle.assignToSurface(_pickerSurfaceId, { source: "video", uri: b.dataset.presetUri });
          closeVideoPicker();
          renderSurfaceList();
          projectionHandle.selectSurface(_pickerSurfaceId);
          // First assignment advances the stepper.
          if (!document.querySelector('.step-btn[data-step="assign"]')?.classList.contains("done")) markStepDone("assign");
        } catch (e) { showError("Preset assign failed: " + (e?.message || e)); }
      });
      presetsEl.dataset.rendered = "1";
    }
    // Reset inline inputs.
    const urlInput = document.getElementById("spv-url"); if (urlInput) urlInput.value = s?.source === "video" ? (s.uri || "") : "";
    const fileInput = document.getElementById("spv-file"); if (fileInput) fileInput.value = "";
    modal.classList.remove("hidden");
  }
  function closeVideoPicker() {
    document.getElementById("surface-video-picker")?.classList.add("hidden");
    _pickerSurfaceId = null;
  }
  document.getElementById("spv-cancel")?.addEventListener("click", closeVideoPicker);
  document.getElementById("spv-confirm")?.addEventListener("click", async () => {
    if (!_pickerSurfaceId) return closeVideoPicker();
    const url = document.getElementById("spv-url")?.value?.trim();
    const file = document.getElementById("spv-file")?.files?.[0];
    try {
      if (file) {
        const kind = file.type.startsWith("image/") ? "image" : "video";
        await projectionHandle.assignToSurface(_pickerSurfaceId, { source: kind, file });
      } else if (url) {
        const kind = /\.(mp4|webm|ogg|mov)$/i.test(url) ? "video" : "image";
        await projectionHandle.assignToSurface(_pickerSurfaceId, { source: kind, uri: url });
      } else {
        closeVideoPicker(); return;
      }
      renderSurfaceList();
      if (!document.querySelector('.step-btn[data-step="assign"]')?.classList.contains("done")) markStepDone("assign");
    } catch (e) { showError("Apply failed: " + (e?.message || e)); }
    closeVideoPicker();
  });
  // Source buttons inside modal: scene / webcam / empty (no URL/file needed).
  document.querySelectorAll("#surface-video-picker [data-spv-src]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!_pickerSurfaceId) return;
      const src = b.dataset.spvSrc;
      try { await projectionHandle.assignToSurface(_pickerSurfaceId, { source: src }); renderSurfaceList(); closeVideoPicker(); if (!document.querySelector('.step-btn[data-step="assign"]')?.classList.contains("done") && src !== "empty") markStepDone("assign"); }
      catch (e) { showError("Source change failed: " + (e?.message || e)); }
    });
  });

  // --- Surface list panel + playback HUD ---------------------------------
  function renderSurfaceList() {
    const panel = document.getElementById("surface-list-panel");
    const list = document.getElementById("surface-list");
    if (!panel || !list) return;
    const items = projectionHandle?.getSurfaces?.() || [];
    if (!items.length) { panel.setAttribute("hidden", ""); list.innerHTML = ""; updatePlaybackHud(); return; }
    panel.removeAttribute("hidden");
    // SECURITY: surfaces[] are unauthenticated payloads from /projection-project/{id}.
    // Escape name/id before any HTML interpolation (see .audit/1-security/C1).
    const _esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
    list.innerHTML = items.map(s => {
      const badge = s.source === "empty" ? "empty" : s.source === "video" ? "🎬" : s.source === "image" ? "🖼️" : s.source === "scene" ? "🌐" : s.source === "webcam" ? "📷" : _esc(s.source);
      const playing = projectionHandle?.isPlaying?.(s.id);
      const canPlay = s.source === "video";
      const playBtn = canPlay
        ? `<button class="sli-btn sli-${playing ? "pause" : "play"}" data-act="${playing ? "pause" : "play"}" title="${playing ? "Pause" : "Play"}">${playing ? "⏸" : "▶"}</button>`
        : "";
      return `<div class="surface-list-item" data-sid="${_esc(s.id)}">
        <span class="sli-name" title="Click to assign">${_esc(s.name)}</span>
        <span class="sli-badge">${badge}</span>
        ${playBtn}
        <button class="sli-btn sli-del" data-act="delete" title="Remove">✕</button>
      </div>`;
    }).join("");
    list.querySelectorAll(".surface-list-item").forEach((item) => {
      const id = item.dataset.sid;
      item.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-act]");
        if (btn) {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === "play") projectionHandle.playSurface(id);
          else if (act === "pause") projectionHandle.pauseSurface(id);
          else if (act === "delete") projectionHandle.removeSurface(id);
          renderSurfaceList();
          return;
        }
        projectionHandle.selectSurface(id);
        openVideoPicker(id);
      });
    });
    updatePlaybackHud();
  }
  function updatePlaybackHud() {
    const hud = document.getElementById("playback-hud");
    if (!hud) return;
    const items = projectionHandle?.getSurfaces?.() || [];
    if (!items.length) { hud.setAttribute("hidden", ""); return; }
    const vids = items.filter(s => s.source === "video");
    const playing = vids.filter(s => projectionHandle.isPlaying(s.id)).length;
    const empty = items.filter(s => s.source === "empty").length;
    hud.removeAttribute("hidden");
    hud.innerHTML = `
      <span class="hud-pill">${items.length} surfaces</span>
      <span class="hud-pill hud-play">▶ ${playing}/${vids.length}</span>
      ${empty ? `<span class="hud-pill hud-empty">${empty} empty</span>` : ""}
    `;
  }
  // Refresh HUD every second so play-state is reflected even without user action.
  setInterval(() => { if (state.mode === "project") renderSurfaceList(); }, 1500);
  window.__renderSurfaceList = renderSurfaceList;
}
// Thin wrapper so setMode() can call it even before wireToolbar runs.
function setProjectionStep(name) { window.__setProjectionStep?.(name); }
function renderSurfaceList() { window.__renderSurfaceList?.(); }

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireToolbar);
} else {
  wireToolbar();
}

// ---------------------------------------------------------------------------
// Init (async — awaits WebGPURenderer.init() before first frame)
// ---------------------------------------------------------------------------
(async () => {
try {
  const created = await createRenderer(els.canvas);
  renderer = created.renderer;
  window.__renderBackend = created.backend;
  // Stereo output — instantiated once the renderer exists; starts in "off" mode.
  stereoOutput = new StereoOutput(renderer);
  window.__stereoOutput = stereoOutput;

  // Stream 4: enable VSM shadow maps for softer, realistic shadows.
  try {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
  } catch (_) { /* WebGPU path may differ — ignore silently */ }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060612);
  scene.fog = new THREE.FogExp2(0x060612, 0.02);

  camera = new THREE.PerspectiveCamera(
    50,
    els.holder.clientWidth / els.holder.clientHeight,
    0.1, 200,
  );
  camera.position.set(10, 8, 10);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, els.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 40;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(els.holder.clientWidth, els.holder.clientHeight),
    0.6, 0.5, 0.1,
  );
  composer.addPass(bloomPass);
  // Stream 3 (scoped): SMAA for sharper edges + better anti-aliasing.
  smaaPass = new SMAAPass(els.holder.clientWidth, els.holder.clientHeight);
  composer.addPass(smaaPass);
  composer.addPass(new OutputPass());

  // Stream 4: HDRI IBL via PMREMGenerator + Poly Haven CC0 HDRIs.
  pmrem = new THREE.PMREMGenerator(renderer);
  try { pmrem.compileEquirectangularShader?.(); } catch (_) {}
  async function loadHDRI(name) {
    const url = HDRI_URLS[name] || HDRI_URLS.studio;
    try {
      const tex = await new RGBELoader().loadAsync(url);
      const env = pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
      if (scene.environment && scene.environment !== env) scene.environment.dispose?.();
      scene.environment = env;
      scene.environmentIntensity = 1.0;
      currentHDRI = name;
    } catch (e) {
      console.warn("[hdri] failed to load", name, e);
    }
  }
  window.loadHDRI = loadHDRI;
  loadHDRI("studio");

  // Stream 4: permanent shadow-casting key + rim lights (survive scene rebuilds).
  keyLight = new THREE.DirectionalLight(0xfff1e0, 2.2);
  keyLight.position.set(8, 12, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 60;
  keyLight.shadow.camera.left = -15; keyLight.shadow.camera.right = 15;
  keyLight.shadow.camera.top = 15; keyLight.shadow.camera.bottom = -15;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.radius = 8;
  scene.add(keyLight);
  window.__keyLight = keyLight;

  rimLight = new THREE.DirectionalLight(0x89b7ff, 0.9);
  rimLight.position.set(-6, 4, -8);
  scene.add(rimLight);

  window.addEventListener("resize", resize);
  resize();

  // Stream 7: apply saved quality preset after composer + keyLight exist.
  applyPreset(loadPreset(), { renderer, composer, keyLight });

  // Stream 1: expose setQuality for UI; expose head-track toggle.
  window.setQuality = (name) => {
    savePreset(name);
    applyPreset(name, { renderer, composer, keyLight });
  };
  window.enableHeadTracking = async () => {
    if (povActive) return { ok: true };
    if (!headTracker) headTracker = new HeadTracker();
    try {
      await headTracker.init();
      headTracker.start();
      povActive = true;
      baseProjectionMatrix = camera.projectionMatrix.clone();
      localStorage.setItem("povEnabled", "1");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  window.disableHeadTracking = () => {
    if (headTracker) { headTracker.stop(); headTracker = null; }
    povActive = false;
    localStorage.setItem("povEnabled", "0");
    if (baseProjectionMatrix) {
      camera.projectionMatrix.copy(baseProjectionMatrix);
      camera.projectionMatrixInverse.copy(baseProjectionMatrix).invert();
    }
  };

  // Hand tracking — same shape as head tracking. Both can run simultaneously
  // off the shared webcam stream (see public/webcam.js).
  window.enableHandTracking = async () => {
    if (handTracker) return { ok: true };
    handTracker = new HandTracker();
    try {
      await handTracker.init();
      handTracker.start();
      baseProjectionMatrix = baseProjectionMatrix || camera.projectionMatrix.clone();
      return { ok: true };
    } catch (e) {
      handTracker = null;
      return { ok: false, error: e.message };
    }
  };
  window.disableHandTracking = () => {
    if (handTracker) { handTracker.stop(); handTracker = null; }
    if (povSource === "hand") povSource = "off";
  };

  // Pose-source pill: "off" | "face" | "hand" | "gaze"
  // "gaze" uses the SAME headTracker — gaze ratios are computed on the iris
  // landmarks (468–477) that FaceLandmarker emits when refineLandmarks is on.
  // No extra webcam consumer, no extra model. See head_tracking.js#init.
  window.setPovSource = async (src) => {
    if (src === "face" || src === "gaze") {
      const r = await window.enableHeadTracking?.();
      if (!r?.ok) return r;
      povSource = src;
    } else if (src === "hand") {
      const r = await window.enableHandTracking?.();
      if (!r?.ok) return r;
      povSource = "hand";
    } else {
      povSource = "off";
    }
    localStorage.setItem("povSource", povSource);
    return { ok: true };
  };
  window.getPovSource = () => povSource;
  // Expose handTracker for the Mapper page to read pose + cursor
  window.__handTracker = () => handTracker;

  // Kick off everything that depends on renderer/scene/camera/controls.
  buildScene(makeDefaultScene());
  applyAiDirectLock();
  loadStoryboard();
  probeBackend();
  animate();
} catch (err) {
  console.error("[init] fatal error — page will not render", err);
  const msg = String(err?.message || err);
  // WebGL context creation failure — usually GPU exhaustion, browser
  // hardware-accel disabled, or too many open tabs with WebGL canvases.
  // Surface a clear, actionable banner with reload + diagnostics.
  if (/WebGL|context/i.test(msg)) {
    try {
      showError(
        "WebGL is unavailable. Try: (1) close other tabs that use 3D/video, " +
        "(2) make sure hardware acceleration is enabled in your browser " +
        "settings, (3) hard-reload (Cmd+Shift+R). Click here to retry."
      );
      const box = document.getElementById("error-box");
      if (box) {
        box.style.cursor = "pointer";
        box.addEventListener("click", () => location.reload(), { once: true });
      }
    } catch (_) {}
  } else {
    try { showError("Init failed: " + msg); } catch (_) {}
  }
  // Still wire the Director panel + prompt input so user can at least type.
  try { applyAiDirectLock(); } catch (_) {}
}
})();
