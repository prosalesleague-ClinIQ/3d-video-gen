// Minimal zero-dep assert helper for the test suite.
// Usage:
//   import { ok, equal, approx, throws, suite } from "./_assert.mjs";
//   suite("PerspT");
//   ok(t.transform(0, 0)[0] === 0, "transform origin to origin");
//
// All failures print to stderr and increment global._failures.
// Each test file calls report() at the end to set process.exitCode.

let _passes = 0;
let _failures = 0;
let _suite = "(no suite)";
const _failedNames = [];

export function suite(name) { _suite = name; console.log(`\n— ${name} —`); }

function _label(msg) { return `[${_suite}] ${msg}`; }

export function ok(cond, msg) {
  if (cond) { _passes++; console.log(`  ✓ ${msg}`); }
  else { _failures++; _failedNames.push(_label(msg)); console.error(`  ✗ ${_label(msg)}`); }
}

export function equal(actual, expected, msg) {
  const eq = (typeof actual === "object")
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (eq) { _passes++; console.log(`  ✓ ${msg}`); }
  else { _failures++; _failedNames.push(_label(msg)); console.error(`  ✗ ${_label(msg)} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
}

export function approx(actual, expected, eps, msg) {
  const diff = Math.abs(actual - expected);
  if (diff <= eps) { _passes++; console.log(`  ✓ ${msg} (Δ=${diff.toExponential(2)})`); }
  else { _failures++; _failedNames.push(_label(msg)); console.error(`  ✗ ${_label(msg)} — got ${actual}, want ${expected} ±${eps} (Δ=${diff})`); }
}

export function approxVec(actual, expected, eps, msg) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
    _failures++;
    _failedNames.push(_label(msg));
    console.error(`  ✗ ${_label(msg)} — shape mismatch`);
    return;
  }
  let ok2 = true;
  for (let i = 0; i < actual.length; i++) {
    if (Math.abs(actual[i] - expected[i]) > eps) { ok2 = false; break; }
  }
  if (ok2) { _passes++; console.log(`  ✓ ${msg}`); }
  else { _failures++; _failedNames.push(_label(msg)); console.error(`  ✗ ${_label(msg)} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)} ±${eps}`); }
}

export async function throws(fn, msg) {
  try { await fn(); _failures++; _failedNames.push(_label(msg)); console.error(`  ✗ ${_label(msg)} — did not throw`); }
  catch (_) { _passes++; console.log(`  ✓ ${msg}`); }
}

export function report() {
  const total = _passes + _failures;
  console.log(`\n${_failures === 0 ? "ALL PASS" : "FAILURES"}: ${_passes}/${total} (suite: ${_suite})`);
  if (_failures > 0) {
    for (const n of _failedNames) console.error("  ! " + n);
    process.exitCode = 1;
  }
  return _failures === 0;
}
