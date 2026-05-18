// Standalone Player — loads a saved projection project by ID and renders it
// with a chosen style preset (space / scary / theater / blacked / framed /
// minimal / cinema / rave). Purpose-built for showing a finished mapping;
// all building / editing lives in mapper.html.

import * as THREE from "three";
import { WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace } from "three";
const AgXToneMapping = THREE.AgXToneMapping ?? null;
const NeutralToneMapping = THREE.NeutralToneMapping ?? null;
const VIVID_TONEMAP = AgXToneMapping ?? NeutralToneMapping ?? ACESFilmicToneMapping;

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { ProjectionMode } from "./projection_mapping.js";
import { STYLES, STYLE_ORDER } from "./player_styles.js";
import { StereoOutput, STEREO_MODES } from "./player_stereo.js";
import { applyCalibrationToElement, onCalibrationChange } from "./calibration.js";

const BACKEND = window.__BACKEND_URL__ || "";

const els = {
  holder: document.getElementById("canvas-holder"),
  canvas: document.getElementById("gl"),
  hint: document.getElementById("player-hint"),
  loadId: document.getElementById("load-id"),
  btnLoad: document.getElementById("btn-load"),
  btnFull: document.getElementById("btn-fullscreen"),
  btnHideUi: document.getElementById("btn-hide-ui"),
  btnPlay: document.getElementById("btn-play"),
  btnPause: document.getElementById("btn-pause"),
  stylePicker: document.getElementById("style-picker"),
  info: document.getElementById("player-info"),
  errorBox: document.getElementById("error-box"),
  statusPill: document.getElementById("status-pill"),
};

function showError(msg) { els.errorBox.textContent = msg; els.errorBox.classList.add("visible"); setTimeout(() => els.errorBox.classList.remove("visible"), 4500); }
function setStatus(kind, text) {
  els.statusPill.className = "status-pill " + (kind === "err" ? "err" : kind === "warm" ? "warm" : "");
  els.statusPill.querySelector(".label").textContent = text;
}

// --- Renderer / scene ---------------------------------------------------
const renderer = new WebGLRenderer({ canvas: els.canvas, antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = VIVID_TONEMAP;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060612);

const camera = new THREE.PerspectiveCamera(50, els.holder.clientWidth / els.holder.clientHeight, 0.1, 200);
camera.position.set(0, 0, 5);

const controls = new OrbitControls(camera, els.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(els.holder.clientWidth, els.holder.clientHeight), 0.6, 0.5, 0.2);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

scene.add(new THREE.AmbientLight(0xffffff, 0.6));

// Stereo 3D output — toggles monaural vs anaglyph / SBS / TB rendering.
const stereo = new StereoOutput(renderer);

function resize() {
  const w = els.holder.clientWidth, h = els.holder.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- Projection ---------------------------------------------------------
let projectionHandle = null;
async function ensureProjection() {
  if (projectionHandle) return projectionHandle;
  projectionHandle = new ProjectionMode();
  await projectionHandle.init({ scene, camera, renderer, composer, holder: els.holder });
  return projectionHandle;
}

// --- Style picker -------------------------------------------------------
let currentStyleId = null;
let styleCtx = null;

function renderStylePicker() {
  els.stylePicker.innerHTML = STYLE_ORDER.map((id, i) => {
    const s = STYLES[id];
    return `<button class="style-chip" data-style="${id}">
      <span class="style-icon">${s.icon}</span>
      <span class="style-name">${s.name}</span>
      <span class="style-key">${i + 1}</span>
    </button>`;
  }).join("");
  els.stylePicker.querySelectorAll("[data-style]").forEach((b) => {
    b.addEventListener("click", () => setStyle(b.dataset.style));
  });
}
renderStylePicker();

// --- Stereo picker ------------------------------------------------------
function renderStereoPicker() {
  const el = document.getElementById("stereo-picker");
  if (!el) return;
  el.innerHTML = STEREO_MODES.map((m) =>
    `<button class="stereo-chip" data-stereo="${m.id}">
      <span class="style-icon">${m.icon}</span>
      <span class="style-name">${m.name}</span>
    </button>`
  ).join("");
  el.querySelectorAll("[data-stereo]").forEach((b) => {
    b.addEventListener("click", () => setStereoMode(b.dataset.stereo));
  });
  // Initialize with "off" active.
  el.querySelector('[data-stereo="off"]')?.classList.add("active");
}
function setStereoMode(mode) {
  stereo.setMode(mode);
  document.querySelectorAll("#stereo-picker [data-stereo]").forEach((b) => b.classList.toggle("active", b.dataset.stereo === mode));
  setStatus("ok", `3D output: ${mode.toUpperCase()}`);
}
renderStereoPicker();
const iod = document.getElementById("stereo-iod");
const iodVal = document.getElementById("stereo-iod-val");
iod?.addEventListener("input", () => {
  const v = parseFloat(iod.value);
  if (iodVal) iodVal.textContent = v.toFixed(3);
  stereo.setEyeSep(v);
});

function setStyle(id) {
  const style = STYLES[id];
  if (!style) return;
  // Cleanup previous
  if (currentStyleId && STYLES[currentStyleId] && styleCtx) {
    try { STYLES[currentStyleId].cleanup(styleCtx); } catch (_) {}
  }
  styleCtx = { scene, renderer, composer, bloomPass, holder: els.holder, projectionHandle };
  try { style.apply(styleCtx); } catch (e) { showError("Style failed: " + (e?.message || e)); }
  currentStyleId = id;
  els.stylePicker.querySelectorAll("[data-style]").forEach((b) => b.classList.toggle("active", b.dataset.style === id));
  setStatus("ok", `Style: ${style.name}`);
}

// --- Load a project -----------------------------------------------------
async function loadProject(id) {
  try {
    setStatus("warm", "Loading project…");
    await ensureProjection();
    await projectionHandle.loadFromBackend(id, BACKEND);
    const surfaces = projectionHandle.getSurfaces();
    // SECURITY: escape unauth project payloads + URL-param id before HTML
    // interpolation (see .audit/1-security/C1).
    const _esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
    els.info.innerHTML = `<strong>${surfaces.length}</strong> surfaces<br>
      <span class="info-ids">${surfaces.map(s => `<code>${_esc(s.name)}</code>`).join(", ") || "—"}</span><br>
      Project ID: <code>${_esc(id)}</code>`;
    els.hint.style.display = "none";
    setStatus("ok", "Loaded");
    // Auto-play all video surfaces on load.
    setTimeout(() => projectionHandle.playAll(), 300);
    return true;
  } catch (e) { showError("Load failed: " + (e?.message || e)); setStatus("err", "Load failed"); return false; }
}

// --- URL params ---------------------------------------------------------
const params = new URLSearchParams(location.search);
const initialId = params.get("id");
const initialStyle = params.get("style");
const autoStart = params.get("auto") === "1";
const hideUi = params.get("clean") === "1";

// Apply initial style before project loads (so scene has the right mood).
setStyle(initialStyle && STYLES[initialStyle] ? initialStyle : "blacked");

if (initialId) {
  els.loadId.value = initialId;
  loadProject(initialId).then(() => {
    if (autoStart) els.btnHideUi?.click();
  });
}
if (hideUi) document.body.classList.add("ui-hidden");

// --- Empty-state "Try the demo" CTA ------------------------------------
// Lightweight demo project: 3 surfaces showing different kaleido + flythrough
// videos. Bypasses the backend (no save/load needed) by building the same
// shape the backend would return and feeding it into the projection handle.
// Useful for first-time visitors who land at /player.html with no ?id=.
document.getElementById("player-hint-demo")?.addEventListener("click", async () => {
  try {
    setStatus("warm", "Building demo project…");
    await ensureProjection();
    // Three flat quads in NDC space — a quick "gallery wall" arrangement.
    // addManualSurface auto-assigns the id; we capture each one to drive the
    // following assignToSurface call.
    const demoSurfaces = [
      { uri: "https://res.cloudinary.com/demo/video/upload/e_kaleidoscope:12/fog.mp4",
        polygon: [[-0.85, 0.6], [-0.2, 0.6], [-0.2, -0.6], [-0.85, -0.6]] },
      { uri: "https://res.cloudinary.com/demo/video/upload/e_accelerate:-60/sea_turtle.mp4",
        polygon: [[-0.05, 0.6], [0.55, 0.6], [0.55, -0.6], [-0.05, -0.6]] },
      { uri: "https://res.cloudinary.com/demo/video/upload/e_boomerang/elephants.mp4",
        polygon: [[0.65, 0.6], [0.95, 0.6], [0.95, -0.6], [0.65, -0.6]] },
    ];
    for (const s of demoSurfaces) {
      const surf = projectionHandle.addManualSurface(s.polygon);
      if (surf?.id) {
        await projectionHandle.assignToSurface(surf.id, { source: "video", uri: s.uri });
      }
    }
    els.hint.style.display = "none";
    els.info.textContent = "Demo project · 3 surfaces · kaleido + drift + flythrough";
    setTimeout(() => projectionHandle.playAll(), 300);
    setStatus("ok", "Demo loaded");
  } catch (e) {
    showError("Demo failed: " + (e?.message || e));
  }
});

// --- Projection calibration carry-over ---------------------------------
// Whatever the user calibrated in the Mapper (4-corner Maptastic drag) is
// auto-saved to localStorage["maptastic.layers"]. Player reads it once at
// load and listens for live changes via the storage event — flip back to
// the Mapper tab, drag a corner, and the Player snaps to it in real time.
applyCalibrationToElement(els.canvas, { elementId: "gl" });
onCalibrationChange(() => applyCalibrationToElement(els.canvas, { elementId: "gl" }));

// --- Controls -----------------------------------------------------------
els.btnLoad?.addEventListener("click", () => {
  const id = els.loadId.value.trim();
  if (id) loadProject(id);
});
els.btnPlay?.addEventListener("click", () => projectionHandle?.playAll());
els.btnPause?.addEventListener("click", () => projectionHandle?.pauseAll());
els.btnFull?.addEventListener("click", async () => {
  if (!document.fullscreenElement) await els.holder.requestFullscreen?.().catch(() => {});
  else await document.exitFullscreen?.();
});
els.btnHideUi?.addEventListener("click", () => document.body.classList.toggle("ui-hidden"));

// One-click Epson preset — SBS + fullscreen + playAll + style → blacked.
document.getElementById("btn-epson")?.addEventListener("click", async () => {
  setStereoMode("sbs");
  setStyle("blacked");
  try { await els.holder.requestFullscreen?.(); } catch (_) {}
  projectionHandle?.playAll();
  setStatus("ok", "Epson 3D: Side-by-Side · fullscreen · Set projector to '3D: Side-by-Side'");
});

// --- Keyboard -----------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea") || e.target.isContentEditable) return;
  const k = e.key.toLowerCase();
  // Shift+0-3 for stereo mode (Off / Anaglyph / SBS / TB).
  if (e.shiftKey) {
    const sidx = parseInt(k, 10);
    if (!Number.isNaN(sidx) && sidx >= 0 && sidx < STEREO_MODES.length) {
      setStereoMode(STEREO_MODES[sidx].id);
      return;
    }
  }
  // Style shortcuts 1-9 + 0 (cycle more if needed)
  const idx = parseInt(k, 10);
  if (idx >= 1 && idx <= Math.min(9, STYLE_ORDER.length)) {
    setStyle(STYLE_ORDER[idx - 1]);
    return;
  }
  if (k === " " || e.code === "Space") {
    e.preventDefault();
    const any = projectionHandle?.getSurfaces().some(s => s.source === "video" && projectionHandle.isPlaying(s.id));
    if (any) projectionHandle.pauseAll(); else projectionHandle?.playAll();
  } else if (k === "f") { els.btnFull?.click(); }
  else if (k === "h") { els.btnHideUi?.click(); }
  else if (k === "arrowright") {
    const i = STYLE_ORDER.indexOf(currentStyleId); setStyle(STYLE_ORDER[(i + 1) % STYLE_ORDER.length]);
  } else if (k === "arrowleft") {
    const i = STYLE_ORDER.indexOf(currentStyleId); setStyle(STYLE_ORDER[(i - 1 + STYLE_ORDER.length) % STYLE_ORDER.length]);
  } else if (k === "escape") {
    if (document.fullscreenElement) document.exitFullscreen?.();
    document.body.classList.remove("ui-hidden");
  }
});

// --- Animation loop -----------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  const dt = clock.getDelta();
  controls.update();

  // Stereo path takes priority if active (renders scene twice).
  if (stereo.mode !== "off") {
    // If projection mode needs to refresh its scene-source RT, let it tick
    // once (without its own composer render — we do stereo below).
    if (projectionHandle) {
      // Quick per-surface VideoTexture update + scene-RT copy.
      try {
        const q = window.__quality || {};
        projectionHandle._frameCount++;
        if (projectionHandle.source === "scene" && projectionHandle.renderTarget &&
            (projectionHandle._frameCount % projectionHandle._sceneCopyEveryN === 0)) {
          const snap = projectionHandle.surfaces.slice();
          const prevG = projectionHandle.calibrationGroup.visible;
          const prevV = snap.map(s => s.visible);
          projectionHandle.calibrationGroup.visible = false;
          snap.forEach(s => { s.visible = false; });
          try {
            renderer.setRenderTarget(projectionHandle.renderTarget);
            renderer.render(scene, camera);
          } finally {
            renderer.setRenderTarget(null);
            projectionHandle.calibrationGroup.visible = prevG;
            snap.forEach((s, i) => { s.visible = prevV[i]; });
          }
        }
        for (const s of projectionHandle.surfaces) {
          const t = s.userData.texture;
          if (t && t.isVideoTexture) t.needsUpdate = true;
        }
      } catch (_) {}
    }
    stereo.render(scene, camera);
  } else {
    if (projectionHandle) projectionHandle.tick();
    else composer.render();
  }

  requestAnimationFrame(animate);
}
animate();
