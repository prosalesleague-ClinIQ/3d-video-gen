// Dedicated AI Projection Mapper dashboard — entry point for mapper.html.
// This is a focused, de-cluttered environment: just a canvas, the scanner
// stepper, and the surface list. All the studio / director / storyboard
// chrome lives in index.html (Studio). All the style presets live in
// player.html (Player). This page only does one thing: build a mapping.

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

import { ProjectionMode, PRESETS } from "./projection_mapping.js";
import { HandTracker } from "./hand_tracking.js";
import Maptastic from "./lib/maptastic.js";
import { LIBRARY, CATEGORIES, getByCategory, getVideoLabel } from "./video_library.js";
import { openSaveModal } from "./save_modal.js";
import { addProject } from "./recent_projects.js";
import { startAutosave, maybeOfferRestore, clearDraft } from "./draft_autosave.js";

const BACKEND = window.__BACKEND_URL__ || "";

const els = {
  holder: document.getElementById("canvas-holder"),
  canvas: document.getElementById("gl"),
  fps: document.getElementById("fps"),
  errorBox: document.getElementById("error-box"),
  statusPill: document.getElementById("status-pill"),
  loadId: document.getElementById("load-id"),
  btnLoad: document.getElementById("btn-load"),
  btnSave: document.getElementById("btn-save"),
  btnSend: document.getElementById("btn-send"),
  saveResult: document.getElementById("save-result"),
  saveIdInput: document.getElementById("save-id"),
  openPlayer: document.getElementById("open-player"),
};

function showError(msg) { els.errorBox.textContent = msg; els.errorBox.classList.add("visible"); setTimeout(() => els.errorBox.classList.remove("visible"), 4500); }

// --- Onboarding overlay: shown on first visit, dismissed forever after ---
// Survives reloads via localStorage. Auto-dismisses when the user clicks
// 🎥 Camera (treating the first real interaction as implicit acknowledgement).
function maybeShowOnboarding() {
  try { if (localStorage.getItem("mapper-onboarding-seen") === "1") return; }
  catch { /* localStorage blocked — show every visit, harmless */ }
  const overlay = document.getElementById("mapper-onboarding");
  if (overlay) overlay.hidden = false;
}
function dismissOnboarding() {
  const overlay = document.getElementById("mapper-onboarding");
  if (overlay) overlay.hidden = true;
  try { localStorage.setItem("mapper-onboarding-seen", "1"); } catch {}
}
document.getElementById("mob-dismiss")?.addEventListener("click", dismissOnboarding);
// Implicit-dismiss: the very first toolbar interaction also dismisses.
document.getElementById("mapper-toolbar")?.addEventListener("click", dismissOnboarding, { once: true });
maybeShowOnboarding();
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
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, els.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(els.holder.clientWidth, els.holder.clientHeight), 0.4, 0.5, 0.2);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Ambient just so MeshStandard-based projected materials don't go pitch black
// if the projected texture has dark areas.
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(2, 4, 5); scene.add(key);

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

// --- Projection mode ----------------------------------------------------
let projectionHandle = null;

// 6-second watchdog — if camera isn't live by then, surface the Retry button
// so the user always has a recovery action even if everything silently failed.
const _camWatchdog = setTimeout(() => {
  if (!projectionHandle?.stream) {
    console.warn("[mapper] camera watchdog: no stream after 6s — showing Retry");
    showRetryCameraButton();
    if (!els.errorBox.classList.contains("visible")) {
      showError("Camera didn't start automatically. Click 🔄 Retry camera below, or open /cam-diag.html for a step-by-step diagnostic.");
    }
  }
}, 6000);

async function bootProjection() {
  // Surface feedback within ~50 ms so the user sees the page isn't dead while
  // ProjectedMaterial loads from the CDN.
  setStatus("warm", "Booting Mapper…");
  try {
    projectionHandle = new ProjectionMode();
    await projectionHandle.init({ scene, camera, renderer, composer, holder: els.holder });
    projectionHandle.mountCornerUI(els.holder, null);

    // --- Draft autosave + restore ---------------------------------------
    // Survives accidental refresh / tab close. Snapshot every 4s as long
    // as there are surfaces. Cleared after a successful save (to avoid
    // re-offering a draft the user has already committed to the backend).
    startAutosave(() => projectionHandle?.getSurfaces?.() || []);
    const restoredDraft = await maybeOfferRestore();
    if (restoredDraft && Array.isArray(restoredDraft) && restoredDraft.length) {
      let restored = 0;
      for (const s of restoredDraft) {
        if (!s?.polygon || s.polygon.length < 3) continue;
        const surf = projectionHandle.addManualSurface(s.polygon);
        if (!surf) continue;
        restored++;
        if ((s.source === "video" || s.source === "image") && s.uri) {
          try { await projectionHandle.assignToSurface(surf.id, { source: s.source, uri: s.uri }); }
          catch { /* drop just this surface, keep going */ }
        } else if (s.source === "scene" || s.source === "webcam") {
          try { await projectionHandle.assignToSurface(surf.id, { source: s.source }); }
          catch {}
        }
      }
      if (restored) {
        renderSurfaceList();
        setStatus("ok", `Restored ${restored} surface${restored === 1 ? "" : "s"} from draft`);
        markStepDone("camera"); markStepDone("scan"); markStepDone("assign");
      }
    }

    // If the user opened this page in a background tab, defer auto-camera —
    // a permission prompt on a hidden tab is confusing and gets autodenied
    // by some browsers. We rerun bootCamera on the next visibilitychange.
    if (document.visibilityState === "hidden") {
      setStatus("ok", "Tab hidden — camera will start when you switch back");
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVisible);
          bootCameraStep();
        }
      };
      document.addEventListener("visibilitychange", onVisible);
      return;
    }
    await bootCameraStep();
  } catch (e) {
    showError("Mapper failed to load: " + (e?.message || e));
  }
}

async function bootCameraStep() {
  console.log("[mapper] bootCameraStep: starting");
  try {
    // Read Permissions API state purely for status messaging — but ALWAYS
    // attempt getUserMedia regardless. Reasons:
    //   - state="denied" can be stale (e.g. user re-enabled in settings
    //     but the page hasn't refreshed); attempting will trigger a real
    //     error we can show.
    //   - state="prompt" — getUserMedia fires the prompt.
    //   - state="granted" — getUserMedia resolves immediately with stream.
    let permState = "prompt";
    try {
      const status = await navigator.permissions?.query?.({ name: "camera" });
      permState = status?.state || "prompt";
      console.log("[mapper] camera permission state:", permState);
    } catch (e) {
      console.log("[mapper] permissions API unavailable:", e?.message);
    }

    setStatus("warm",
      permState === "granted" ? "Starting camera…" :
      permState === "denied"  ? "Trying camera (was previously blocked)…" :
                                "Requesting camera permission…");

    try {
      await projectionHandle.setSource("webcam");
      console.log("[mapper] camera started, stream:", !!projectionHandle.stream);
      clearTimeout(_camWatchdog);
      showWebcamPreview();
      markStepDone("camera");
      setStatus("ok", "Camera live · click Scan or Random");
      hideRetryCameraButton();
      window.__refreshToolbar?.();
    } catch (e) {
      const m = String(e?.message || e || "");
      console.warn("[mapper] camera failed:", m);
      if (/denied|permission|notallowed/i.test(m)) {
        showError("Camera permission denied. Click the 🔒 (or 📷) icon in the URL bar, set Camera → Allow, then click Retry below.");
        setStatus("err", "Camera permission denied");
      } else if (/notreadable|busy|tracks/i.test(m)) {
        showError("Camera is in use by another app (FaceTime / Zoom / OBS). Close it and click Retry.");
        setStatus("err", "Camera busy");
      } else if (/notfound|no device/i.test(m)) {
        showError("No camera detected on this device. Plug one in and click Retry.");
        setStatus("err", "No camera");
      } else if (/secure|https/i.test(m) || (location.protocol !== "https:" && location.hostname !== "localhost")) {
        showError("Camera requires HTTPS. Open https://3d-video-gen.vercel.app instead of file:// or http://.");
        setStatus("err", "HTTPS required");
      } else {
        showError("Camera failed: " + m + " — click Retry below.");
        setStatus("err", "Camera not started");
      }
      showRetryCameraButton();
    }
  } catch (e) {
    console.error("[mapper] bootCameraStep fatal:", e);
    showError("Mapper failed to start camera: " + (e?.message || e));
    showRetryCameraButton();
  }
}

// ===== Persistent Retry-camera button — always available when camera is off
let _retryBtn = null;
function showRetryCameraButton() {
  if (_retryBtn) return;
  const btn = document.createElement("button");
  btn.textContent = "🔄 Retry camera";
  btn.className = "primary";
  btn.style.cssText = `
    position: absolute;
    top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 50;
    padding: 16px 28px;
    font-size: 15px;
    border-radius: 12px;
    cursor: pointer;
  `;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Requesting…";
    await bootCameraStep();
    btn.disabled = false;
    btn.textContent = "🔄 Retry camera";
  });
  els.holder.appendChild(btn);
  _retryBtn = btn;
}
function hideRetryCameraButton() {
  _retryBtn?.remove();
  _retryBtn = null;
}
bootProjection();

// --- Webcam preview thumbnail (so the user actually SEES the camera is on)
let _webcamPreview = null;
function showWebcamPreview() {
  if (!projectionHandle?.stream) return;
  if (_webcamPreview) {
    // Re-attach if needed
    if (_webcamPreview.srcObject !== projectionHandle.stream) {
      _webcamPreview.srcObject = projectionHandle.stream;
    }
    return;
  }
  const v = document.createElement("video");
  v.autoplay = true;
  v.muted = true;
  v.playsInline = true;
  v.srcObject = projectionHandle.stream;
  v.style.cssText = `
    position: absolute;
    bottom: 14px;
    left: 14px;
    width: 200px;
    height: 150px;
    object-fit: cover;
    border-radius: 12px;
    border: 1px solid rgba(140, 230, 255, 0.6);
    box-shadow:
      0 14px 36px rgba(0, 0, 0, 0.7),
      0 0 28px rgba(92, 204, 255, 0.45),
      inset 0 1px 0 rgba(220, 245, 255, 0.4);
    background: rgba(0, 0, 0, 0.6);
    z-index: 30;
    transform: translateZ(60px);
    pointer-events: none;
  `;
  els.holder.appendChild(v);
  _webcamPreview = v;
  // Tiny "LIVE" badge
  const badge = document.createElement("div");
  badge.textContent = "● LIVE";
  badge.style.cssText = `
    position: absolute;
    bottom: 158px;
    left: 22px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: #ff6464;
    text-shadow: 0 0 8px rgba(255, 100, 100, 0.7);
    z-index: 31;
    pointer-events: none;
    letter-spacing: 0.1em;
  `;
  els.holder.appendChild(badge);
  badge.dataset.webcamBadge = "1";
}
function hideWebcamPreview() {
  _webcamPreview?.remove();
  _webcamPreview = null;
  els.holder.querySelectorAll("[data-webcam-badge]").forEach(b => b.remove());
}

// --- Stepper + helpers (ported from app.js, mapper-only) ---------------
const setProjectionStep = (name) => {
  document.querySelectorAll(".step-btn").forEach((b) => b.classList.toggle("active", b.dataset.step === name));
};
function markStepDone(step) {
  document.querySelector(`.step-btn[data-step="${step}"]`)?.classList.add("done");
  if (step === "camera") {
    document.querySelector('.step-btn[data-step="scan"]')?.removeAttribute("disabled");
    setProjectionStep("scan");
  } else if (step === "scan") {
    ["detail", "lumi", "draw", "randomize", "assign"].forEach(s => document.querySelector(`.step-btn[data-step="${s}"]`)?.removeAttribute("disabled"));
    setProjectionStep("assign");
  } else if (step === "assign") {
    document.querySelector('.step-btn[data-step="play"]')?.removeAttribute("disabled");
    setProjectionStep("play");
  }
}

// =================== TOOLBAR STATE ===================
let _selectedSurfaceId = null;
let _muted = false;
let _looping = true;
let _gridOn = false;
let _hudOn = true;
let _recorder = null;
let _recordChunks = [];

function getSelected() {
  return _selectedSurfaceId
    || projectionHandle?.surfaces?.find?.(s => s.userData.selected)?.userData.surfaceId
    || projectionHandle?.surfaces?.[0]?.userData.surfaceId
    || null;
}
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// =================== STEP / ACTION DISPATCHER ===================
document.querySelectorAll(".step-btn").forEach((btn) => btn.addEventListener("click", async () => {
  if (!projectionHandle) return;
  const step = btn.dataset.step;
  const act  = btn.dataset.act;
  btn.disabled = true;
  try {
    // ---- ACTIONS (data-act) ----
    if (act === "webcam-toggle") {
      _webcamPreview ? hideWebcamPreview() : showWebcamPreview();
    }
    else if (act === "duplicate") {
      const id = getSelected(); if (!id) { showError("Select a surface first."); return; }
      const s = projectionHandle.getSurfaces().find(x => x.id === id);
      if (s?.polygon) {
        const offset = s.polygon.map(([x,y]) => [x + 0.05, y - 0.05]);
        const dup = projectionHandle.addManualSurface(offset);
        if (dup && s.source !== "empty") {
          await projectionHandle.assignToSurface(dup.id, { source: s.source, uri: s.uri });
        }
        renderSurfaceList();
        setStatus("ok", "Surface duplicated");
      }
    }
    else if (act === "delete") {
      const id = getSelected(); if (!id) { showError("Select a surface first."); return; }
      projectionHandle.removeSurface(id);
      _selectedSurfaceId = null;
      renderSurfaceList();
      setStatus("ok", "Surface removed");
    }
    else if (act === "clear-all") {
      if (confirm("Remove ALL detected surfaces?")) {
        projectionHandle.clearSurfaces();
        renderSurfaceList();
        setStatus("ok", "All surfaces cleared");
      }
    }
    else if (act === "reset-corners") {
      projectionHandle.setCorners([[-0.6, 0.35], [0.6, 0.35], [0.6, -0.35], [-0.6, -0.35]]);
      setStatus("ok", "Corners reset");
    }
    else if (act === "all-scene" || act === "all-webcam" || act === "all-clear") {
      const src = act === "all-scene" ? "scene" : act === "all-webcam" ? "webcam" : "empty";
      const ids = projectionHandle.getSurfaces().map(s => s.id);
      setStatus("warm", `Setting ${ids.length} surfaces → ${src}…`);
      for (const id of ids) {
        try { await projectionHandle.assignToSurface(id, { source: src }); } catch (_) {}
      }
      renderSurfaceList();
      setStatus("ok", `All surfaces → ${src}`);
    }
    else if (act === "grid-toggle") {
      _gridOn = !_gridOn;
      els.holder.classList.toggle("show-grid", _gridOn);
      btn.classList.toggle("active", _gridOn);
      setStatus("ok", "Grid " + (_gridOn ? "on" : "off"));
    }
    else if (act === "hud-toggle") {
      _hudOn = !_hudOn;
      document.getElementById("surface-list-panel")?.classList.toggle("force-hidden", !_hudOn);
      document.getElementById("playback-hud")?.classList.toggle("force-hidden", !_hudOn);
      btn.classList.toggle("active", !_hudOn);
    }
    else if (act === "fullscreen") {
      if (!document.fullscreenElement) await els.holder.requestFullscreen?.();
      else await document.exitFullscreen?.();
    }
    else if (act === "calibrate") {
      toggleCalibrate();
      btn.classList.toggle("active", _calibrating);
    }
    else if (act === "pause") {
      projectionHandle.pauseAll();
      setStatus("ok", "Paused all");
    }
    else if (act === "mute-toggle") {
      _muted = !_muted;
      projectionHandle.surfaces.forEach(s => { if (s.userData.videoEl) s.userData.videoEl.muted = _muted; });
      btn.classList.toggle("active", _muted);
      setStatus("ok", _muted ? "Muted all" : "Unmuted all");
    }
    else if (act === "loop-toggle") {
      _looping = !_looping;
      projectionHandle.surfaces.forEach(s => { if (s.userData.videoEl) s.userData.videoEl.loop = _looping; });
      btn.classList.toggle("active", _looping);
      setStatus("ok", "Loop " + (_looping ? "on" : "off"));
    }
    else if (act === "sync") {
      projectionHandle.surfaces.forEach(s => {
        const v = s.userData.videoEl; if (!v) return;
        v.currentTime = 0; v.play().catch(() => {});
      });
      setStatus("ok", "Synced t=0");
    }
    else if (act === "snapshot") {
      // Force a fresh render to RT, then dump canvas pixels as PNG
      try { renderer.render(scene, camera); } catch (_) {}
      els.canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `mapper-snapshot-${Date.now()}.png`);
        setStatus("ok", "Snapshot saved");
      }, "image/png");
    }
    else if (act === "record") {
      if (_recorder && _recorder.state === "recording") {
        _recorder.stop();
        btn.classList.remove("active");
        btn.textContent = "🔴 Rec";
        return;
      }
      try {
        const stream = els.canvas.captureStream(30);
        _recordChunks = [];
        _recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
        _recorder.ondataavailable = (e) => { if (e.data.size) _recordChunks.push(e.data); };
        _recorder.onstop = () => {
          const blob = new Blob(_recordChunks, { type: "video/webm" });
          downloadBlob(blob, `mapper-recording-${Date.now()}.webm`);
          setStatus("ok", "Recording saved");
        };
        _recorder.start();
        btn.classList.add("active");
        btn.textContent = "⏹ Stop";
        setStatus("warm", "Recording WebM… click again to stop");
      } catch (e) {
        showError("Recording failed: " + (e?.message || e));
      }
    }
    else if (act === "export-json") {
      const json = JSON.stringify(projectionHandle.serialize("export"), null, 2);
      downloadBlob(new Blob([json], { type: "application/json" }), `mapper-project-${Date.now()}.json`);
      setStatus("ok", "Project JSON downloaded");
    }
    // ---- STEPS (data-step) ----
    else if (step === "camera") {
      setStatus("warm", "Requesting camera permission…");
      await projectionHandle.setSource("webcam");
      showWebcamPreview();
      setStatus("ok", "Camera live · click 2 · 🤖 Scan");
      markStepDone("camera");
    } else if (step === "scan") {
      setStatus("warm", "Scanning surfaces… (first scan loads OpenCV ~10MB)");
      const polys = await projectionHandle.detectSurfacesAI();
      if (!polys.length) { showError("No surfaces detected. Try better lighting or move closer."); return; }
      projectionHandle.createSurfacesFromAI(polys);
      renderSurfaceList();
      setStatus("ok", `Detected ${polys.length} surface${polys.length === 1 ? "" : "s"}`);
      markStepDone("scan");
    } else if (step === "detail") {
      setStatus("warm", "Detail scanning…");
      const polys = await projectionHandle.detectDetailedSurfaces();
      if (!polys.length) { showError("No detailed surfaces found."); return; }
      projectionHandle.createSurfacesFromAI(polys);
      renderSurfaceList();
      setStatus("ok", `Detail: ${polys.length} surfaces`);
    } else if (step === "lumi") {
      setStatus("warm", "Scanning light/dark regions…");
      const regions = await projectionHandle.detectLuminanceRegions();
      if (!regions.length) { showError("No luminance regions found. Try better lighting."); return; }
      projectionHandle.createSurfacesFromLuminance(regions);
      renderSurfaceList();
      const dark  = regions.filter(r => r.tag === "dark").length;
      const light = regions.filter(r => r.tag === "light").length;
      setStatus("ok", `Luminance: ${dark} dark · ${light} light regions`);
    } else if (step === "draw") {
      startDrawSurface();
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
      setStatus("ok", "Playing all");
    }
  } catch (e) {
    const m = String(e?.message || e || "");
    if (step === "camera") {
      if (/denied|permission/i.test(m)) {
        showError("Camera permission denied. Click the 🔒 / camera icon in the URL bar, set Camera → Allow, then reload.");
      } else if (/notfound|no device|no such device/i.test(m)) {
        showError("No camera detected. Plug one in or grant access to a built-in webcam, then click Camera again.");
      } else if (/notreadable|busy|tracks/i.test(m)) {
        showError("Camera is in use by another app. Close FaceTime / Zoom / OBS and click Camera again.");
      } else if (/secure|https/i.test(m) || (location.protocol !== "https:" && location.hostname !== "localhost")) {
        showError("Camera requires HTTPS. Use the live URL (https://3d-video-gen.vercel.app).");
      } else {
        showError(`Camera failed: ${m}`);
      }
      setStatus("err", "Camera not started");
    } else {
      showError(`Step '${step}' failed: ${m}`);
    }
  }
  finally { btn.disabled = false; }
}));

// --- Draw-a-surface tool ------------------------------------------------
let _drawing = null;
function startDrawSurface() {
  if (_drawing) return;
  _drawing = { points: [], overlay: null };
  setStatus("warm", "Click 3+ points on canvas, double-click to close (Esc cancels)");
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
  if (e.target.closest(".projection-stepper, .surface-list-panel, .surface-video-picker, .app-nav, .mapper-sidebar")) return;
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

// --- Raycaster click / hover -------------------------------------------
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function ndcFromEvent(e) {
  const rect = els.holder.getBoundingClientRect();
  _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}
function raycastSurfaces(e) {
  if (!projectionHandle?.surfaces?.length) return null;
  ndcFromEvent(e);
  _ray.setFromCamera(_ndc, camera);
  const hits = _ray.intersectObjects(projectionHandle.surfaces, false);
  return hits[0]?.object || null;
}
els.holder.addEventListener("pointerdown", (e) => {
  if (_drawing) return;
  if (e.target.closest(".surface-video-picker, .projection-stepper, .mapper-toolbar, .surface-list-panel")) return;
  const hit = raycastSurfaces(e);
  if (!hit) return;
  _selectedSurfaceId = hit.userData.surfaceId;
  projectionHandle.selectSurface(_selectedSurfaceId);
  refreshToolbarEnabled();
  openVideoPicker(hit.userData.surfaceId);
});
els.holder.addEventListener("pointermove", (e) => {
  if (_drawing) return;
  const hit = raycastSurfaces(e);
  document.body.style.cursor = hit ? "pointer" : "";
});

// --- Video picker modal -------------------------------------------------
let _pickerSurfaceId = null;
let _pickerCat = "all";     // active category filter
let _pickerQuery = "";      // active search query (lowercased)

// Render the category-tab row above the grid. Once.
function renderPickerCategories() {
  const el = document.getElementById("spv-cats");
  if (!el || el.dataset.rendered === "1") return;
  // SECURITY: CATEGORIES is a constant from our own bundle — no escape needed,
  // but we mirror the escape pattern used elsewhere for consistency.
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  el.innerHTML = CATEGORIES.map((c) =>
    `<button class="spv-cat-btn ${c.id === _pickerCat ? "active" : ""}" data-cat="${esc(c.id)}" title="${esc(c.name)}">${esc(c.icon)} ${esc(c.name)}</button>`
  ).join("");
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-cat]"); if (!b) return;
    _pickerCat = b.dataset.cat;
    el.querySelectorAll(".spv-cat-btn").forEach((x) => x.classList.toggle("active", x === b));
    renderPickerLibrary();
  });
  el.dataset.rendered = "1";
}

// Re-render the filtered preset grid. Called on category change + search input.
function renderPickerLibrary() {
  const grid = document.getElementById("spv-presets");
  if (!grid) return;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  let items = getByCategory(_pickerCat);
  if (_pickerQuery) {
    items = items.filter((v) => (v.name + " " + v.id).toLowerCase().includes(_pickerQuery));
  }
  if (!items.length) {
    grid.innerHTML = `<div class="spv-empty">No videos match "${esc(_pickerQuery)}" in ${esc(_pickerCat)}.</div>`;
    return;
  }
  grid.innerHTML = items.map((v) =>
    `<button class="preset-chip" data-preset-uri="${esc(v.uri)}" title="${esc(v.id)}">${esc(v.name)}</button>`
  ).join("");
}

function openVideoPicker(surfaceId) {
  _pickerSurfaceId = surfaceId;
  const modal = document.getElementById("surface-video-picker");
  const title = document.getElementById("spv-title");
  const s = projectionHandle.getSurfaces().find(x => x.id === surfaceId);
  if (title && s) {
    // SECURITY: surface name may originate from a loaded project — escape it.
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
    title.innerHTML = `Pick a video for &quot;${esc(s.name)}&quot;`;
  }
  // Category tabs + library grid (one-time render of the tab row, refreshes
  // grid every open in case the search/category were left in a weird state).
  renderPickerCategories();
  renderPickerLibrary();

  const presetsEl = document.getElementById("spv-presets");
  if (!presetsEl.dataset.rendered) {
    presetsEl.addEventListener("click", async (ev) => {
      const b = ev.target.closest("button[data-preset-uri]"); if (!b) return;
      try {
        await projectionHandle.assignToSurface(_pickerSurfaceId, { source: "video", uri: b.dataset.presetUri });
        closeVideoPicker();
        renderSurfaceList();
        projectionHandle.selectSurface(_pickerSurfaceId);
        if (!document.querySelector('.step-btn[data-step="assign"]')?.classList.contains("done")) markStepDone("assign");
      } catch (e) { showError("Preset failed: " + (e?.message || e)); }
    });
    presetsEl.dataset.rendered = "1";
  }
  // Wire the search input — live filter.
  const searchEl = document.getElementById("spv-search");
  if (searchEl && !searchEl.dataset.wired) {
    searchEl.addEventListener("input", (ev) => {
      _pickerQuery = ev.target.value.trim().toLowerCase();
      renderPickerLibrary();
    });
    searchEl.dataset.wired = "1";
  }
  document.getElementById("spv-url").value = s?.source === "video" ? (s.uri || "") : "";
  document.getElementById("spv-file").value = "";
  // Pro controls: reflect current per-surface state.
  const mesh = projectionHandle.surfaces.find(m => m.userData.surfaceId === surfaceId);
  const opEl = document.getElementById("spv-opacity");
  const tiEl = document.getElementById("spv-tint");
  const fxEl = document.getElementById("spv-faux3d");
  if (opEl) opEl.value = (mesh?.material?.opacity ?? 1).toString();
  if (tiEl) tiEl.value = "#" + (mesh?.material?.color?.getHexString?.() || "ffffff");
  if (fxEl) fxEl.checked = !!mesh?.userData._faux3DEnabled;
  modal.classList.remove("hidden");
}
function closeVideoPicker() {
  document.getElementById("surface-video-picker")?.classList.add("hidden");
  _pickerSurfaceId = null;
}
document.getElementById("spv-cancel")?.addEventListener("click", closeVideoPicker);
// Live pro-controls — apply immediately as the user drags/picks.
document.getElementById("spv-opacity")?.addEventListener("input", (e) => {
  if (_pickerSurfaceId) projectionHandle.setSurfaceOpacity(_pickerSurfaceId, parseFloat(e.target.value));
});
document.getElementById("spv-tint")?.addEventListener("input", (e) => {
  if (_pickerSurfaceId) projectionHandle.setSurfaceTint(_pickerSurfaceId, e.target.value);
});
document.getElementById("spv-faux3d")?.addEventListener("change", (e) => {
  if (_pickerSurfaceId) projectionHandle.setSurfaceFaux3D(_pickerSurfaceId, e.target.checked);
});
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
    } else { closeVideoPicker(); return; }
    renderSurfaceList();
    if (!document.querySelector('.step-btn[data-step="assign"]')?.classList.contains("done")) markStepDone("assign");
  } catch (e) { showError("Apply failed: " + (e?.message || e)); }
  closeVideoPicker();
});
document.querySelectorAll("#surface-video-picker [data-spv-src]").forEach((b) => {
  b.addEventListener("click", async () => {
    if (!_pickerSurfaceId) return;
    const src = b.dataset.spvSrc;
    try { await projectionHandle.assignToSurface(_pickerSurfaceId, { source: src }); renderSurfaceList(); closeVideoPicker(); if (src !== "empty" && !document.querySelector('.step-btn[data-step="assign"]')?.classList.contains("done")) markStepDone("assign"); }
    catch (e) { showError("Source change failed: " + (e?.message || e)); }
  });
});

// --- Surface list + HUD -------------------------------------------------
function renderSurfaceList() {
  const panel = document.getElementById("surface-list-panel");
  const list = document.getElementById("surface-list");
  const items = projectionHandle?.getSurfaces?.() || [];
  if (!items.length) { panel.setAttribute("hidden", ""); list.innerHTML = ""; updatePlaybackHud(); return; }
  panel.removeAttribute("hidden");
  // SECURITY: escape any value originating from a loaded project (name/id come
  // from /projection-project/{id} which is unauth — see .audit/1-security/C1).
  const _esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  list.innerHTML = items.map(s => {
    const badge = s.source === "empty" ? "empty" : s.source === "video" ? "🎬" : s.source === "image" ? "🖼️" : s.source === "scene" ? "🌐" : s.source === "webcam" ? "📷" : _esc(s.source);
    const playing = projectionHandle.isPlaying(s.id);
    const canPlay = s.source === "video";
    const playBtn = canPlay ? `<button class="sli-btn" data-act="${playing ? "pause" : "play"}">${playing ? "⏸" : "▶"}</button>` : "";
    // Resolve uri → human-readable label (LIBRARY entry name, or Cloudinary
    // filename, or "(empty)"). Shows the user WHAT'S MAPPED WHERE, which
    // used to be invisible — the previous list only showed a source badge.
    const assignedLabel = (s.source === "video" || s.source === "image") ? getVideoLabel(s.uri)
                        : s.source === "scene"  ? "🌐 Live scene"
                        : s.source === "webcam" ? "📷 Webcam"
                        : "(empty)";
    return `<div class="surface-list-item" data-sid="${_esc(s.id)}">
      <div class="sli-text">
        <span class="sli-name">${_esc(s.name)}</span>
        <span class="sli-assigned" title="${_esc(s.uri || '')}">${_esc(assignedLabel)}</span>
      </div>
      <span class="sli-badge">${badge}</span>
      ${playBtn}
      <button class="sli-btn sli-del" data-act="delete">✕</button>
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
      _selectedSurfaceId = id;
      projectionHandle.selectSurface(id);
      refreshToolbarEnabled();
      openVideoPicker(id);
    });
  });
  updatePlaybackHud();
  refreshToolbarEnabled();
}

// Enable toolbar buttons based on current state. Called from renderSurfaceList
// + after every step transition.
function refreshToolbarEnabled() {
  const surfaces = projectionHandle?.getSurfaces?.() || [];
  const hasSurfaces = surfaces.length > 0;
  const hasSelected = !!_selectedSurfaceId && surfaces.some(s => s.id === _selectedSurfaceId);
  const hasVideo    = surfaces.some(s => s.source === "video");
  const cameraOn    = !!projectionHandle?.stream;
  const enable = (sel, on) => document.querySelectorAll(sel).forEach(b => { on ? b.removeAttribute("disabled") : b.setAttribute("disabled", ""); });
  // Capture group
  enable('[data-act="webcam-toggle"]', cameraOn);
  // Detect group needs camera
  enable('[data-step="scan"], [data-step="detail"], [data-step="lumi"]', cameraOn);
  // Surfaces group
  enable('[data-step="draw"]', cameraOn);
  enable('[data-act="duplicate"], [data-act="delete"]', hasSelected);
  enable('[data-act="clear-all"]', hasSurfaces);
  // Assign group
  enable('[data-step="randomize"], [data-step="assign"], [data-act="all-scene"], [data-act="all-webcam"], [data-act="all-clear"]', hasSurfaces);
  // Playback group
  enable('[data-step="play"], [data-act="pause"], [data-act="mute-toggle"], [data-act="loop-toggle"], [data-act="sync"]', hasVideo);
  // Output JSON needs surfaces
  enable('[data-act="export-json"]', hasSurfaces);
}
window.__refreshToolbar = refreshToolbarEnabled;
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
setInterval(renderSurfaceList, 1500);

// --- Keyboard -----------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea") || e.target.isContentEditable) return;
  const k = e.key.toLowerCase();
  if (k === " " || e.code === "Space") {
    e.preventDefault();
    const anyPlaying = projectionHandle?.getSurfaces().some(s => s.source === "video" && projectionHandle.isPlaying(s.id));
    if (anyPlaying) projectionHandle.pauseAll(); else projectionHandle?.playAll();
    renderSurfaceList();
  } else if (k === "d") { document.querySelector('.step-btn[data-step="detail"]')?.click(); }
  else if (k === "l") { document.querySelector('.step-btn[data-step="lumi"]')?.click(); }
  else if (k === "r") { document.querySelector('.step-btn[data-step="randomize"]')?.click(); }
  else if (k === "escape") { if (_drawing) cancelDraw(); closeVideoPicker(); }
  else if (k === "m") { e.preventDefault(); toggleCalibrate(); }
});

// --- Maptastic projection-calibration overlay ---------------------------
// Press `M` (or click the 🎯 Calibrate toolbar button) to enter calibration
// mode. The WebGL canvas keeps rendering; Maptastic just adds 4 drag-handles
// at the corners and applies a `matrix3d(...)` CSS transform to the canvas
// element. The transform persists to localStorage so the calibration survives
// reloads — same flow as upstream maptastic, just scoped to OUR canvas id.
let _maptastic = null;
let _calibrating = false;

function ensureMaptasticInstance() {
  if (_maptastic) return _maptastic;
  // Maptastic owns its own fullscreen overlay <canvas> that draws the handles
  // and bounding box. The layer it transforms is the WebGL canvas (#gl).
  _maptastic = Maptastic({
    layers: ["gl"],
    labels: false,
    crosshairs: false,
    screenbounds: false,
    autoSave: true,
    autoLoad: true,
    onchange: () => {
      // Future: bridge the matrix into projection_mapping.js as a shader
      // uniform via computeSurfaceHomography. For the MVP, the CSS transform
      // Maptastic applies to #gl is enough — the WebGL output is warped at
      // composition time.
    },
  });
  return _maptastic;
}

function toggleCalibrate() {
  ensureMaptasticInstance();
  _calibrating = !_calibrating;
  _maptastic.setConfigEnabled(_calibrating);
  document.body.classList.toggle("mapper-calibrating", _calibrating);
  setStatus(_calibrating ? "warm" : "ok", _calibrating ? "Calibrating — drag corners; press M to exit" : "Calibration saved");
}

// --- Save / Load / Send-to-Player --------------------------------------
// Save flow now uses the shared save_modal.js — no browser prompt(). The
// modal handles the name input, calls saveToBackend, shows the result with
// a copy-link button + open-in-player CTA, and pushes the project into
// recent_projects.js for cross-page history.
els.btnSave?.addEventListener("click", async () => {
  if (!projectionHandle) return;
  const result = await openSaveModal({
    suggestedName: "untitled",
    saver: (name) => projectionHandle.saveToBackend(name, BACKEND),
  });
  if (result?.ok) {
    // Mirror the legacy sidebar UI for users who scroll/look there.
    if (els.saveIdInput) els.saveIdInput.value = result.id;
    if (els.openPlayer) els.openPlayer.href = `player.html?id=${encodeURIComponent(result.id)}&style=blacked`;
    els.saveResult?.removeAttribute("hidden");
    // Saved to backend → the autosave draft is no longer the freshest
    // copy; clear it so the next visit won't offer to restore.
    clearDraft();
    setStatus("ok", "Saved");
  } else if (result === null) {
    setStatus("ok", "Save cancelled");
  } else if (result?.error) {
    showError("Save failed: " + result.error);
  }
});
els.btnLoad?.addEventListener("click", async () => {
  const id = els.loadId?.value?.trim();
  if (!id || !projectionHandle) return;
  try {
    await projectionHandle.loadFromBackend(id, BACKEND);
    // Track the load in the recent-projects history so the Player can show
    // it as a quick-launch card.
    addProject({ id, name: id, source: "loaded" });
    renderSurfaceList();
    markStepDone("camera"); markStepDone("scan"); markStepDone("assign");
    setStatus("ok", "Loaded");
  } catch (e) { showError("Load failed: " + (e?.message || e)); }
});
els.btnSend?.addEventListener("click", async () => {
  if (!projectionHandle) return;
  try {
    const res = await projectionHandle.saveToBackend("mapper-quicksend", BACKEND);
    addProject({ id: res.project_id, name: "mapper-quicksend", source: "saved" });
    const url = `player.html?id=${encodeURIComponent(res.project_id)}&style=blacked&auto=1`;
    window.open(url, "_blank");
    els.saveIdInput && (els.saveIdInput.value = res.project_id);
    els.openPlayer && (els.openPlayer.href = url);
    els.saveResult?.removeAttribute("hidden");
    setStatus("ok", "Sent to player");
  } catch (e) { showError("Send failed: " + (e?.message || e)); }
});

// --- Animation loop -----------------------------------------------------
const clock = new THREE.Clock();
let fpsSamples = [];
function animate() {
  const dt = clock.getDelta();
  controls.update();
  if (projectionHandle) projectionHandle.tick();
  else composer.render();
  const fps = 1 / (dt || 0.016);
  fpsSamples.push(fps);
  if (fpsSamples.length > 30) fpsSamples.shift();
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  const surfCount = projectionHandle?.surfaces.length || 0;
  els.fps.textContent = `${avg.toFixed(0)} fps · ${surfCount} surfaces`;
  requestAnimationFrame(animate);
}
animate();

// Auto-load if URL has ?id=
const params = new URLSearchParams(location.search);
const autoId = params.get("id");
if (autoId && els.loadId) {
  els.loadId.value = autoId;
  setTimeout(() => els.btnLoad?.click(), 800);
}

// =================== HAND TRACKING — air-cursor + air-pinch ===================
// Adds an additional input modality on top of the mouse: index-fingertip
// drives a cursor dot in the canvas, and a thumb+index pinch fires synthetic
// pointerdown/up at the cursor location so the existing raycaster + assign
// modal flow Just Works without any duplicate UX logic.
let _handTracker = null;
let _handDot = null;
let _handPinchPrev = false;
let _handTickRunning = false;
let _handBtn = null;

function ensureHandDot() {
  if (_handDot) return _handDot;
  const d = document.createElement("div");
  d.id = "hand-cursor-dot";
  d.style.cssText = `
    position:absolute; width:28px; height:28px; margin:-14px 0 0 -14px;
    border-radius:50%; pointer-events:none; z-index:45;
    background: radial-gradient(circle at 30% 30%, #fff 0%, #5cf 50%, #1a5a8c 100%);
    box-shadow: 0 0 0 2px rgba(255,255,255,0.6), 0 0 26px rgba(92,204,255,1),
                0 0 60px rgba(92,204,255,0.6), 0 6px 18px rgba(0,0,0,0.6);
    transition: opacity 0.2s, transform 0.05s linear;
    opacity: 0;
  `;
  els.holder.appendChild(d);
  _handDot = d;
  return d;
}

function setHandDotPosition(canvasX, canvasY, visible = true) {
  const d = ensureHandDot();
  d.style.left = canvasX + "px";
  d.style.top  = canvasY + "px";
  d.style.opacity = visible ? "1" : "0";
}

// Dispatch a synthetic pointer event (PointerEvent) at the given page coords.
function dispatchSyntheticPointer(type, clientX, clientY) {
  const ev = new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    clientX, clientY,
    pointerType: "pen",   // distinguish from mouse for any handlers that care
    isPrimary: true,
    button: 0,
  });
  // Fire on canvas-holder so Mapper's existing pointerdown handler picks it up.
  els.holder.dispatchEvent(ev);
}

function handTick() {
  if (!_handTickRunning) return;
  if (_handTracker) {
    const pose = _handTracker.getPose();
    if (pose && pose.confidence > 0.4) {
      // Map normalized image-x (mirrored) to canvas-x. The raw tip.x is in
      // [0,1] left→right of the SOURCE image; selfie cameras are mirrored,
      // so left in image == right on screen.
      const rect = els.holder.getBoundingClientRect();
      const cx = (1 - pose.tip.x) * rect.width;
      const cy = pose.tip.y * rect.height;
      const pageX = rect.left + cx;
      const pageY = rect.top  + cy;
      setHandDotPosition(cx, cy, true);

      // Pinch edges now come from HandGestureClassifier (palm-normalised, EMA-
      // smoothed, hysteresis-gated, N-frame-stability-gated) via the one-shot
      // `pose.pinchEdge` field. Far fewer mis-fires than the previous
      // threshold-on-amplitude approach.
      const edge = pose.pinchEdge;            // "down" | "up" | null
      const pinchClosed = pose.pinch >= 0.95;
      if (edge === "down") {
        _handPinchPrev = true;
        dispatchSyntheticPointer("pointerdown", pageX, pageY);
      } else if (edge === "up") {
        _handPinchPrev = false;
        dispatchSyntheticPointer("pointerup", pageX, pageY);
      } else if (pinchClosed && _handPinchPrev) {
        // Continuous pointermove while pinched (drag-like).
        dispatchSyntheticPointer("pointermove", pageX, pageY);
      }
      // The pinchEdge field is one-shot — clear it so the next frame's null
      // doesn't get mis-read. (Tracker also resets it next tick.)
      pose.pinchEdge = null;
    } else {
      setHandDotPosition(0, 0, false);
    }
  }
  requestAnimationFrame(handTick);
}

async function enableMapperHandTracking() {
  if (_handTracker) return true;
  try {
    setStatus("warm", "Starting hand tracking…");
    _handTracker = new HandTracker();
    await _handTracker.init();
    _handTracker.start();
    _handTickRunning = true;
    requestAnimationFrame(handTick);
    setStatus("ok", "✋ Hand tracking on — point with index finger, pinch to click");
    if (_handBtn) {
      _handBtn.classList.add("active");
      _handBtn.title = "Hand tracking ON — click to disable";
    }
    return true;
  } catch (e) {
    showError("Hand tracking failed: " + (e?.message || e));
    setStatus("err", "Hand tracking failed");
    _handTracker = null;
    return false;
  }
}
function disableMapperHandTracking() {
  _handTickRunning = false;
  _handTracker?.stop();
  _handTracker = null;
  setHandDotPosition(0, 0, false);
  setStatus("ok", "Hand tracking off");
  if (_handBtn) {
    _handBtn.classList.remove("active");
    _handBtn.title = "Toggle hand tracking";
  }
}
window.__mapperToggleHand = () => {
  if (_handTracker) disableMapperHandTracking();
  else enableMapperHandTracking();
};

// Add a "✋ Hand" toggle button to the Capture section of the toolbar.
(function injectHandToolbarButton() {
  const captureSection = document.querySelector(".tb-section .tb-label");
  if (!captureSection) return;
  const captureGroup = captureSection.parentElement;
  if (!captureGroup) return;
  const btn = document.createElement("button");
  btn.className = "step-btn";
  btn.dataset.act = "hand-toggle";
  btn.title = "Toggle hand tracking — point with index, pinch to click";
  btn.innerHTML = "✋ Hand";
  btn.addEventListener("click", () => window.__mapperToggleHand?.());
  captureGroup.appendChild(btn);
  _handBtn = btn;
})();
