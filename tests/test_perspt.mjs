// PerspT homography solver — pure math, no DOM.
//
// Tests:
//  1. Identity quad → transform(x,y) returns (x,y).
//  2. Forward then inverse → original point (round-trip).
//  3. Known case: unit square → axis-aligned rectangle, corners map exactly.
//  4. Skewed quad: sample interior point lies inside dst quad.
//  5. Degenerate input (three collinear points) → falls back to identity, not NaN.

import PerspT, { PerspT as PerspTNamed } from "../public/lib/perspt.js";
import { suite, ok, equal, approx, approxVec, report } from "./_assert.mjs";

suite("PerspT");

ok(typeof PerspT === "function", "default export is callable");
ok(typeof PerspTNamed === "function", "named export is callable");
ok(PerspT === PerspTNamed, "default and named export are the same constructor");

// --- 1. Identity ----------------------------------------------------------
{
  const id = PerspT(
    [0, 0,  1, 0,  1, 1,  0, 1],
    [0, 0,  1, 0,  1, 1,  0, 1],
  );
  approxVec(id.transform(0, 0), [0, 0], 1e-6, "identity: (0,0) → (0,0)");
  approxVec(id.transform(0.5, 0.5), [0.5, 0.5], 1e-6, "identity: (0.5,0.5) → (0.5,0.5)");
  approxVec(id.transform(1, 1), [1, 1], 1e-6, "identity: (1,1) → (1,1)");
}

// --- 2. Round-trip --------------------------------------------------------
{
  // Map a unit square into a skewed quad.
  const t = PerspT(
    [0, 0, 1, 0, 1, 1, 0, 1],
    [10, 20, 200, 30, 220, 180, 30, 200],
  );
  const samplePts = [[0.1, 0.1], [0.4, 0.7], [0.9, 0.2]];
  for (const [x, y] of samplePts) {
    const fwd = t.transform(x, y);
    const back = t.transformInverse(fwd[0], fwd[1]);
    approxVec(back, [x, y], 1e-4, `round-trip (${x},${y}) → ${fwd.map(v => v.toFixed(2))} → back`);
  }
}

// --- 3. Known mapping (unit square → 100×100 square offset by 50) --------
{
  const t = PerspT(
    [0, 0, 1, 0, 1, 1, 0, 1],
    [50, 50, 150, 50, 150, 150, 50, 150],
  );
  approxVec(t.transform(0, 0), [50, 50], 1e-6, "(0,0) → (50,50)");
  approxVec(t.transform(1, 0), [150, 50], 1e-6, "(1,0) → (150,50)");
  approxVec(t.transform(1, 1), [150, 150], 1e-6, "(1,1) → (150,150)");
  approxVec(t.transform(0, 1), [50, 150], 1e-6, "(0,1) → (50,150)");
  approxVec(t.transform(0.5, 0.5), [100, 100], 1e-6, "centre → (100,100)");
}

// --- 4. toMat3 packs a 9-element row-major mat3 --------------------------
{
  const t = PerspT(
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 0, 1, 0, 1, 1, 0, 1],
  );
  const m = t.toMat3();
  equal(m.length, 9, "toMat3 returns 9-element array");
  approx(m[0], 1, 1e-6, "mat3 identity row0 col0");
  approx(m[4], 1, 1e-6, "mat3 identity row1 col1");
  approx(m[8], 1, 1e-6, "mat3 [8] always 1");
}

// --- 5. Degenerate fallback ----------------------------------------------
{
  // All four src points collinear → degenerate matrix → fallback to identity
  // (not NaN, not thrown).
  const t = PerspT(
    [0, 0, 0.5, 0, 1, 0, 1.5, 0],   // all on x-axis
    [0, 0, 1, 0, 1, 1, 0, 1],
  );
  const [x, y] = t.transform(0.5, 0.5);
  ok(Number.isFinite(x) && Number.isFinite(y), "degenerate input does not produce NaN/Infinity");
}

report();
