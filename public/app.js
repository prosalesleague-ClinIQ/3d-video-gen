// Kaleidoscope studio — Three.js viewer + Director panel + photo-to-3D + storyboard film compiler.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

RectAreaLightUniformsLib.init();

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
};

// ---------------------------------------------------------------------------
// Renderer + scene setup
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  canvas: els.canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060612);
scene.fog = new THREE.FogExp2(0x060612, 0.02);

const camera = new THREE.PerspectiveCamera(
  50,
  els.holder.clientWidth / els.holder.clientHeight,
  0.1, 200,
);
camera.position.set(10, 8, 10);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, els.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 40;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.5;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(els.holder.clientWidth, els.holder.clientHeight),
  0.6, 0.5, 0.1,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function resize() {
  const w = els.holder.clientWidth;
  const h = els.holder.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

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

const state = {
  mode: "orbit",
  tourT: 0,
  tourDuration: 8.0,
  animT: 0,
  animDuration: 4.0,
  kaleidoSegments: 6,
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
  kaleidoClones.forEach(c => { scene.remove(c); disposeMesh(c); });
  kaleidoClones = [];

  const candidates = dynamicObjects.filter(m => m.userData.isKaleidoCandidate);
  if (candidates.length === 0) return;

  for (let seg = 1; seg < segments; seg++) {
    const angle = (seg / segments) * Math.PI * 2;
    candidates.forEach(original => {
      const clone = new THREE.Mesh(original.geometry, original.material.clone());
      clone.userData.baseClone = { original, angle };
      scene.add(clone);
      kaleidoClones.push(clone);
    });
  }
}

function disableKaleido() {
  kaleidoClones.forEach(c => { scene.remove(c); disposeMesh(c); });
  kaleidoClones = [];
}

function updateKaleidoClones() {
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

function setMode(mode) {
  state.mode = mode;
  els.modeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.mode === mode));
  els.viewerHint.style.opacity = mode === "orbit" ? "0.8" : "0.4";

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

// Parallax
els.holder.addEventListener("pointermove", (e) => {
  if (state.mode === "tour") return;
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
    if (state.mode === "tour" || !e.beta || !e.gamma) return;
    state.parallax.tx = Math.max(-1, Math.min(1, e.gamma / 30));
    state.parallax.ty = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
  });
}

// Animation loop
const clock = new THREE.Clock();
let fpsSamples = [];

function animate() {
  const dt = clock.getDelta();

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
  } else {
    state.parallax.x += (state.parallax.tx - state.parallax.x) * 0.08;
    state.parallax.y += (state.parallax.ty - state.parallax.y) * 0.08;
    camera.position.x += state.parallax.x * 0.15;
    camera.position.y -= state.parallax.y * 0.15;
    controls.update();
  }

  composer.render();

  const fps = 1 / (dt || 0.016);
  fpsSamples.push(fps);
  if (fpsSamples.length > 30) fpsSamples.shift();
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  els.fps.textContent = `${avg.toFixed(0)} fps · ${dynamicObjects.length + kaleidoClones.length} meshes`;

  requestAnimationFrame(animate);
}
animate();

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
function collectDirection() {
  if (els.aiDirect.checked) return { ai_direct: true };
  return {
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
// Init
// ---------------------------------------------------------------------------
buildScene(makeDefaultScene());
applyAiDirectLock();
loadStoryboard();
probeBackend();
