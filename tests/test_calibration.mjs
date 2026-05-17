// calibration.js — projector-alignment helper used by Player to apply the
// Mapper's Maptastic state to its own canvas.
//
// We need a tiny localStorage + DOM shim because calibration.js touches
// both. Node's vm module would be overkill — just monkey-patch globals.

import { suite, ok, equal, approx, report } from "./_assert.mjs";

// --- minimal localStorage shim --------------------------------------------
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};

// --- minimal "DOM element" shim -------------------------------------------
class FakeEl {
  constructor(id = "gl") {
    this.id = id;
    this.style = {};
    this.dataset = {};
  }
}

// `window` — calibration.js's onCalibrationChange uses it. Stub the
// addEventListener API.
const _listeners = [];
globalThis.window = {
  addEventListener: (type, fn) => _listeners.push({ type, fn }),
  removeEventListener: (type, fn) => {
    const i = _listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) _listeners.splice(i, 1);
  },
};
function dispatchStorage(key) {
  for (const l of _listeners) if (l.type === "storage") l.fn({ key });
}

const cal = await import("../public/calibration.js");

suite("calibration");

ok(typeof cal.applyCalibrationToElement === "function", "applyCalibrationToElement exported");
ok(typeof cal.clearCalibrationOnElement === "function", "clearCalibrationOnElement exported");
ok(typeof cal.clearCalibration === "function", "clearCalibration exported");
ok(typeof cal.onCalibrationChange === "function", "onCalibrationChange exported");
ok(typeof cal.loadStoredLayout === "function", "loadStoredLayout exported");

// --- loadStoredLayout returns null when nothing is stored ----------------
{
  localStorage.clear();
  equal(cal.loadStoredLayout(), null, "loadStoredLayout returns null when key absent");
}

// --- writing a layout returns the parsed value ---------------------------
{
  const layout = [{
    id: "gl",
    sourcePoints: [[0, 0], [800, 0], [800, 600], [0, 600]],
    targetPoints: [[10, 5], [780, 15], [820, 580], [-5, 605]],
  }];
  localStorage.setItem("maptastic.layers", JSON.stringify(layout));
  const got = cal.loadStoredLayout();
  ok(Array.isArray(got) && got.length === 1, "loadStoredLayout returns the array");
  equal(got[0].id, "gl", "loaded layout has correct id");
}

// --- applyCalibrationToElement actually sets style.transform ------------
{
  const el = new FakeEl("gl");
  const applied = cal.applyCalibrationToElement(el);
  ok(applied, "applyCalibrationToElement returns true when layout exists");
  ok(typeof el.style.transform === "string" && el.style.transform.startsWith("matrix3d("),
    `transform is matrix3d(…) (got: ${el.style.transform?.slice(0, 30)}…)`);
  equal(el.dataset.calibrated, "1", "element gets dataset.calibrated=1");
  equal(el.style.transformOrigin, "0 0", "transformOrigin set to 0 0");
}

// --- clearCalibrationOnElement strips the transform ---------------------
{
  const el = new FakeEl("gl");
  cal.applyCalibrationToElement(el);
  cal.clearCalibrationOnElement(el);
  equal(el.style.transform, "", "clearCalibrationOnElement empties style.transform");
  ok(el.dataset.calibrated === undefined, "clearCalibrationOnElement removes dataset.calibrated");
}

// --- applyCalibrationToElement returns false when no layout exists ------
{
  localStorage.removeItem("maptastic.layers");
  const el = new FakeEl("gl");
  equal(cal.applyCalibrationToElement(el), false, "returns false when no layout in storage");
}

// --- onCalibrationChange fires on storage events ------------------------
{
  // Repopulate so the callback sees a layout.
  localStorage.setItem("maptastic.layers", JSON.stringify([{
    id: "gl",
    sourcePoints: [[0, 0], [800, 0], [800, 600], [0, 600]],
    targetPoints: [[10, 5], [780, 15], [820, 580], [-5, 605]],
  }]));

  let calls = 0;
  let lastLayout = null;
  const unsub = cal.onCalibrationChange((layout) => { calls++; lastLayout = layout; });
  dispatchStorage("maptastic.layers");
  equal(calls, 1, "onCalibrationChange callback fired once on storage event");
  ok(Array.isArray(lastLayout) && lastLayout.length === 1, "callback receives the parsed layout");

  // Unsubscribe should stop calls.
  unsub();
  dispatchStorage("maptastic.layers");
  equal(calls, 1, "callback NOT fired after unsubscribe");

  // Unrelated storage events ignored.
  const unsub2 = cal.onCalibrationChange(() => { calls++; });
  dispatchStorage("some-other-key");
  equal(calls, 1, "callback ignores storage events for other keys");
  unsub2();
}

report();
