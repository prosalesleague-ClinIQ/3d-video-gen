// calibration.js — shared projector-alignment helper.
//
// Maptastic (mapper.html only) saves its 4-corner layout to localStorage
// under "maptastic.layers". This module reads that layout and applies the
// equivalent `matrix3d(...)` CSS transform to any DOM element on any page,
// so the calibration set in the Mapper persists into the Player.
//
// Usage:
//   import { applyCalibrationToElement, clearCalibration } from "./calibration.js";
//   applyCalibrationToElement(document.getElementById("gl"));
//
// We also accept a layout passed in directly (used by Maptastic's
// `onchange` callback so we don't bounce through localStorage in the hot
// path).

import PerspT from "./lib/perspt.js";

// Inlined (intentionally) — duplicating the 1-line matrix3d builder from
// projection_mapping.js so this module can be imported in environments
// that don't have three.js (Node tests, future Web Worker, etc.).
// projection_mapping.js's `homographyToCss` is the canonical version;
// keep them in sync if you change the format.
function homographyToCss(perspt) {
  const c = perspt.coeffs;
  return `matrix3d(${c[0]},${c[3]},0,${c[6]},${c[1]},${c[4]},0,${c[7]},0,0,1,0,${c[2]},${c[5]},0,1)`;
}

const STORAGE_KEY = "maptastic.layers";

// Read whatever Maptastic last saved. Returns the raw layout array
// (each entry: { id, sourcePoints, targetPoints }) or null.
export function loadStoredLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const layout = JSON.parse(raw);
    if (!Array.isArray(layout) || layout.length === 0) return null;
    return layout;
  } catch {
    return null;
  }
}

// Find the layout entry for a specific element id, or fall back to the
// first entry (Maptastic typically has just one layer).
export function findLayoutFor(elementId, layout = null) {
  const layers = layout || loadStoredLayout();
  if (!layers) return null;
  return layers.find((l) => l.id === elementId) || layers[0] || null;
}

// Build a PerspT homography from a Maptastic layer entry. `sourcePoints`
// are the element's native corners; `targetPoints` are where the user
// dragged them to.
export function homographyFromLayer(layer) {
  if (!layer || !layer.sourcePoints || !layer.targetPoints) return null;
  const flat = (q) => [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]];
  return PerspT(flat(layer.sourcePoints), flat(layer.targetPoints));
}

// Apply the saved calibration (if any) to a DOM element. Returns true if
// a calibration was found and applied, false if no calibration exists.
//
// The element must have its `transform-origin` set to `0 0` for the
// matrix3d coordinates to land where expected — we set this ourselves.
export function applyCalibrationToElement(el, { elementId = null, layout = null } = {}) {
  if (!el) return false;
  const layer = findLayoutFor(elementId || el.id, layout);
  if (!layer) return false;
  const h = homographyFromLayer(layer);
  if (!h) return false;
  el.style.transformOrigin = "0 0";
  el.style.transform = homographyToCss(h);
  el.dataset.calibrated = "1";
  return true;
}

// Strip any calibration transform we applied.
export function clearCalibrationOnElement(el) {
  if (!el) return;
  el.style.transform = "";
  delete el.dataset.calibrated;
}

// Wipe localStorage (and reset both Studio + Player on next load).
export function clearCalibration() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// Subscribe to calibration changes across tabs (Maptastic writes localStorage
// in mapper.html; the storage event lets the Player auto-react when the
// user adjusts corners and tabs back to the Player tab).
export function onCalibrationChange(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = (e) => { if (e.key === STORAGE_KEY) callback(loadStoredLayout()); };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
