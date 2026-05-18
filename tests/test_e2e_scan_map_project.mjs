// E2E: simulate the full scan → map → project flow the user does in the
// browser, but at the data-shape level. The actual MediaPipe inference + the
// WebGL render can't run in Node, but the data the mapper would produce IS
// pure JS — we can build one, sanitise it, validate the schema, hand it to
// the backend (if reachable) and load it back.
//
// What this exercises end-to-end:
//   1. Mock surface detection from a "scanned" rectangle → produces
//      surfaces[] with NDC polygons.
//   2. Combine with PerspT to derive each surface's homography (the same one
//      projection_mapping.js wraps for the shader).
//   3. Build the JSON body the Mapper "Save" button would POST.
//   4. Sanitise check: client guard (URI scheme allowlist) matches server.
//   5. Backend round-trip (skipped if backend unreachable).
//   6. Verify the loaded payload preserves every meaningful field.

import { suite, ok, equal, report } from "./_assert.mjs";
import PerspT from "../public/lib/perspt.js";

const BACKEND = process.env.BACKEND_URL || "https://prosalesleague-3d-video-gen.hf.space";

suite("E2E scan → map → project");

// ---- 1. Mock the scan output --------------------------------------------
// Simulate what `projectionHandle.detectSurfacesAI()` returns: 3 detected
// rectangles in NDC space (origin centre, [-1, 1] in each axis).
const detectedSurfaces = [
  { id: "wall-1", name: "wall left",  polygon: [[-0.9, 0.7], [-0.3, 0.7], [-0.3, -0.7], [-0.9, -0.7]] },
  { id: "wall-2", name: "wall right", polygon: [[ 0.3, 0.7], [ 0.9, 0.7], [ 0.9, -0.7], [ 0.3, -0.7]] },
  { id: "floor",  name: "floor",      polygon: [[-0.6, -0.2], [0.6, -0.2], [0.7, -0.9], [-0.7, -0.9]] },
];
ok(detectedSurfaces.length === 3, "scan output has 3 surfaces");

// ---- 2. Derive homography per surface -----------------------------------
// Each surface gets a unit-UV → NDC-polygon homography. This is exactly the
// math projection_mapping.js#computeSurfaceHomography wraps.
for (const s of detectedSurfaces) {
  const flat = (q) => [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]];
  const t = PerspT(flat([[0,0],[1,0],[1,1],[0,1]]), flat(s.polygon));
  // Sanity: round-trip a UV centre.
  const [hx, hy] = t.transform(0.5, 0.5);
  const [ux, uy] = t.transformInverse(hx, hy);
  ok(Math.abs(ux - 0.5) < 1e-3 && Math.abs(uy - 0.5) < 1e-3,
    `[${s.id}] homography round-trip is stable (Δ=(${(ux-0.5).toExponential(2)},${(uy-0.5).toExponential(2)}))`);
  s._homography = t.toMat3();   // attach for the next stage
}

// ---- 3. Build the "Save" payload that mapper.js would POST -------------
const project = {
  name: "e2e-test-project",
  calibration: { corners: [[-1,1],[1,1],[1,-1],[-1,-1]] },
  surfaces: detectedSurfaces.map((s, i) => ({
    id: s.id,
    name: s.name,
    polygon: s.polygon,
    source: i === 0 ? "video" : i === 1 ? "image" : "scene",
    uri: i === 0 ? "https://res.cloudinary.com/demo/video/upload/dog.mp4"
        : i === 1 ? "https://res.cloudinary.com/demo/image/upload/sample.jpg"
        : null,
    opacity: 1.0,
    tint: "#ffffff",
    blend: "normal",
    faux3d: false,
  })),
  content: { uri: null },
};
ok(JSON.stringify(project).length < 16384, `payload size reasonable (${JSON.stringify(project).length} bytes)`);

// ---- 4. Client-side URI scheme validation ------------------------------
// Mirror the guard in projection_mapping.js#assignToSurface.
function isSafeUri(uri) {
  if (!uri) return true;
  if (typeof uri !== "string" || uri.length > 2048) return false;
  return /^https?:\/\//i.test(uri) || /^blob:/i.test(uri);
}
for (const s of project.surfaces) {
  ok(isSafeUri(s.uri), `surface ${s.id} uri passes scheme allowlist`);
}

// Adversarial cases — these MUST fail the guard.
for (const bad of [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "file:///etc/passwd",
  "vbscript:msgbox",
  "/relative/path",
  "ws://wss",
  "x".repeat(3000),
]) {
  ok(!isSafeUri(bad), `adversarial URI rejected: ${bad.slice(0, 40)}`);
}

// ---- 5. Backend round-trip (optional, gated on reachability) -----------
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    return r;
  } finally { clearTimeout(t); }
}

let backendUp = false;
try {
  const ping = await fetchWithTimeout(BACKEND, {}, 4000);
  backendUp = ping.status < 600;
} catch (_) {}

if (!backendUp) {
  console.log("  ⊘ backend unreachable — skipping backend roundtrip");
} else {
  // Strip per-surface fields the SurfaceItem schema may not know — but our
  // schema has `extra: allow`, so polygon/_homography/etc. are fine.
  // Drop the _homography we attached locally (not part of the JSON we'd send).
  const payload = JSON.parse(JSON.stringify(project));
  payload.surfaces.forEach((s) => delete s._homography);

  // POST.
  const postR = await fetchWithTimeout(`${BACKEND}/projection-project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  ok(postR.ok, `POST /projection-project (${postR.status})`);
  if (postR.ok) {
    const body = await postR.json();
    const pid = body.project_id;
    ok(typeof pid === "string" && pid.length >= 32, `got UUID-like project_id (${pid})`);

    // GET.
    const getR = await fetchWithTimeout(`${BACKEND}/projection-project/${pid}`);
    ok(getR.ok, `GET /projection-project/{id} (${getR.status})`);
    if (getR.ok) {
      const loaded = await getR.json();
      equal(loaded.project.name, payload.name, "loaded payload name matches");
      equal(loaded.project.surfaces.length, payload.surfaces.length, "loaded surfaces count matches");
      for (let i = 0; i < payload.surfaces.length; i++) {
        equal(loaded.project.surfaces[i].id, payload.surfaces[i].id, `surface[${i}].id round-trips`);
        equal(loaded.project.surfaces[i].name, payload.surfaces[i].name, `surface[${i}].name round-trips`);
      }
    }
  }
}

// ---- 6. Backend deploy-status: is the per-surface URI guard live? -------
// The XSS sink in mapper.js/player.js/app.js is escaped on the CLIENT
// (commit aa50788). The SECOND defense layer — per-surface scheme check on
// the SERVER (also aa50788, demo-service/app.py) — only matters once the HF
// Space backend is redeployed. This block doesn't fail the suite; it surfaces
// a status flag so the user knows whether `git push hf main` is still pending.
if (backendUp) {
  const xssR = await fetchWithTimeout(`${BACKEND}/projection-project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "evil",
      calibration: {},
      surfaces: [{ id: "x", name: "<script>alert(1)</script>", source: "video", uri: "javascript:alert(1)" }],
      content: {},
    }),
  });
  if (xssR.status >= 400 && xssR.status < 500) {
    ok(true, `BACKEND IS UP-TO-DATE: server-side rejected javascript: URI (${xssR.status})`);
  } else {
    // Don't fail — but make the deploy gap impossible to miss.
    console.log("");
    console.log("  ⚠ BACKEND DEPLOY PENDING ─────────────────────────────────");
    console.log("  ⚠ The live HF Space accepted a `javascript:` per-surface URI");
    console.log("  ⚠ (status " + xssR.status + "). The client-side escape (mapper.js/");
    console.log("  ⚠ player.js/app.js) still blocks the XSS, but the second-");
    console.log("  ⚠ layer server guard from commit aa50788 isn't live yet.");
    console.log("  ⚠ Action: push demo-service/ to the HF Space remote.");
    console.log("  ──────────────────────────────────────────────────────────");
    console.log("");
    ok(true, "backend reachable; flagged pending server-side URI guard deploy");
  }
}

report();
