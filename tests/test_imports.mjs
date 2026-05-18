// Import-graph integrity check.
//
// Goal: every "leaf" public/* ESM resolves cleanly under Node and exports the
// symbols the rest of the codebase depends on. Modules that pull in three.js
// / MediaPipe / DOM are NOT importable in Node — for those we rely on the
// `node --check` syntax pass run by tests/run_all.sh.
//
// What we validate here:
//   public/onee_filter.js       → OneEuroFilter, OneEuroVec
//   public/hand_filters.js      → HandGestureClassifier, EMA, computeApproximatePalmSize
//   public/lib/perspt.js        → default + named PerspT
//   public/gaze_tracking.js     → GazeTracker (default + named)
//   public/lib/maptastic.js     → Maptastic (default + named)  [DOM-touching;
//                                  we just check the module loads & exports
//                                  the symbol; we don't invoke the function]

import { suite, ok, equal, report } from "./_assert.mjs";

suite("imports");

async function checkModule(path, expectedExports) {
  let mod;
  try {
    mod = await import(path);
  } catch (e) {
    ok(false, `${path} loads — ${e.message}`);
    return;
  }
  ok(true, `${path} loads cleanly`);
  for (const name of expectedExports) {
    if (name === "default") {
      ok(mod.default !== undefined, `${path} has default export`);
    } else {
      ok(mod[name] !== undefined, `${path} exports ${name}`);
    }
  }
}

await checkModule("../public/onee_filter.js", ["OneEuroFilter", "OneEuroVec"]);
await checkModule("../public/hand_filters.js", ["default", "HandGestureClassifier", "EMA", "computeApproximatePalmSize"]);
await checkModule("../public/lib/perspt.js", ["default", "PerspT"]);
await checkModule("../public/gaze_tracking.js", ["default", "GazeTracker"]);
await checkModule("../public/recent_projects.js", ["addProject", "removeProject", "clearAll", "listProjects", "timeAgo", "onChange"]);

// Maptastic touches `document` at runtime but the module body itself only
// declares a `const Maptastic = function(config) { ... }` — defining the
// function does NOT touch document. So the import should succeed and we just
// check the symbol is exported.
//
// If Node refuses to load due to a top-level DOM reference, that's a real
// regression and we want this test to flag it.
await checkModule("../public/lib/maptastic.js", ["default", "Maptastic"]);

report();
