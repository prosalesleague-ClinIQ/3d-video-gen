// AI projection 3D mapping — new mode that slots into app.js alongside
// orbit / tour / kaleido / splat. Ships the §PHASE 10 MVP from the spec:
//   camera → contours → one surface → one 4-point calibration → one
//   mapped output → one saved project.
//
// Two operating modes fall out of `setSource()`:
//   "webcam" — standalone: projector maps webcam feed onto the calibrated quad
//   "scene"  — integrated: projector maps the existing Three.js scene render
//              (the orbit/tour/kaleido output) via a WebGLRenderTarget
//   "upload" — static texture from <input type=file> (image)
//
// Reuses, does not re-implement:
//   - getUserMedia lifecycle (head_tracking.js:33-54 pattern)
//   - dynamic CDN imports (splat_viewer.js:12-17 pattern)
//   - off-axis frustum math for projector-pose calibration (head_tracking.js:129)
//   - KaleidoEffect wrapper shape {.pass|.uniforms.get|.setSize} (kaleido_shader.js:53-100)
//   - Quality presets keys projectorResolution / detectEveryNFrames (quality.js)
//   - In-memory save/load via demo-service /projection-project endpoints

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Preset video library — Cloudinary demo account MP4s. All verified live with
// `Access-Control-Allow-Origin: *` (required for WebGL VideoTexture to avoid
// tainting the canvas). User can also paste a URL or upload a file.
// ---------------------------------------------------------------------------
export const PRESETS = [
  { id: "dog",     name: "🐕 Dog",     uri: "https://res.cloudinary.com/demo/video/upload/dog.mp4" },
  { id: "turtle",  name: "🐢 Sea turtle", uri: "https://res.cloudinary.com/demo/video/upload/sea_turtle.mp4" },
  { id: "eleph",   name: "🐘 Elephants", uri: "https://res.cloudinary.com/demo/video/upload/elephants.mp4" },
  { id: "kitten",  name: "🐱 Kittens",  uri: "https://res.cloudinary.com/demo/video/upload/kitten_fighting.mp4" },
  { id: "eagle",   name: "🦅 Eagle",    uri: "https://res.cloudinary.com/demo/video/upload/eagle.mp4" },
  { id: "cat",     name: "🐈 Cat",      uri: "https://res.cloudinary.com/demo/video/upload/cat.mp4" },
];

// Returns true if `poly` (NDC) overlaps any polygon in `others` by more than
// `iou` (intersection-over-union of axis-aligned bounds, cheap approximation).
function _polyOverlapsAny(poly, others, iou = 0.5) {
  const bounds = (p) => {
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  const a = bounds(poly);
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  for (const o of others) {
    const b = bounds(o);
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const inter = ix * iy;
    const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
    const union = Math.max(1e-6, areaA + areaB - inter);
    if (inter / union > iou) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CDN loaders
// ---------------------------------------------------------------------------
const OPENCV_SCRIPT   = "https://docs.opencv.org/4.10.0/opencv.js";
const PROJMAT_MODULES = [
  // v2.2.2 is the actual latest on npm (verified via CDN probe — no v4.x exists).
  "https://cdn.jsdelivr.net/npm/three-projected-material@2.2.2/build/ProjectedMaterial.module.js",
  "https://unpkg.com/three-projected-material@2.2.2/build/ProjectedMaterial.module.js",
];

let _cvReady = null;
function loadOpenCV() {
  if (_cvReady) return _cvReady;
  _cvReady = new Promise((resolve, reject) => {
    if (window.cv && window.cv.Mat) return resolve(window.cv);
    const existing = document.querySelector(`script[src="${OPENCV_SCRIPT}"]`);
    const s = existing || document.createElement("script");
    s.async = true;
    if (!existing) {
      s.src = OPENCV_SCRIPT;
      document.head.appendChild(s);
    }
    const done = () => {
      if (window.cv && window.cv.Mat) return resolve(window.cv);
      window.cv = window.cv || {};
      window.cv["onRuntimeInitialized"] = () => resolve(window.cv);
    };
    if (s.readyState === "complete" || s.readyState === "loaded") done();
    else s.addEventListener("load", done, { once: true });
    s.addEventListener("error", () => reject(new Error("opencv_load_failed")), { once: true });
    // Hard timeout — OpenCV WASM is ~10 MB.
    setTimeout(() => {
      if (!(window.cv && window.cv.Mat)) reject(new Error("opencv_load_timeout"));
    }, 30000);
  });
  return _cvReady;
}

let _projMatCtor = null;
async function loadProjectedMaterial() {
  if (_projMatCtor) return _projMatCtor;
  let lastErr;
  for (const url of PROJMAT_MODULES) {
    try {
      const mod = await import(url);
      _projMatCtor = mod.default || mod.ProjectedMaterial;
      if (_projMatCtor) return _projMatCtor;
    } catch (e) { lastErr = e; }
  }
  throw new Error("projected_material_load_failed: " + (lastErr?.message || "unknown"));
}

// ---------------------------------------------------------------------------
// Thin ProjectedMaterial wrapper — mirrors KaleidoEffect shape so callers get
// a stable surface if we swap the underlying lib later.
// ---------------------------------------------------------------------------
class ProjectionMaterialWrapper {
  constructor(ProjectedMaterial, { camera, texture, color = 0xffffff }) {
    this.material = new ProjectedMaterial({ camera, texture, color, transparent: true });
    this.uniforms = {
      get: (name) => ({ value: this.material[name] }),
      set: (name, value) => { this.material[name] = value; },
    };
  }
  setTexture(tex) { this.material.texture = tex; this.material.needsUpdate = true; }
  project(mesh) { if (this.material.project) this.material.project(mesh); }
  dispose() { this.material.dispose?.(); }
}

// ---------------------------------------------------------------------------
// ProjectionMode — slots into app.js setMode("project")
// ---------------------------------------------------------------------------
export class ProjectionMode {
  constructor() {
    this.scene = null;
    this.camera = null;     // host orbit camera (for scene-source render)
    this.renderer = null;
    this.composer = null;
    this.holder = null;

    // Our own camera used as the "projector" — projects texture onto surfaces.
    this.projector = null;
    this.projectorHelper = null;

    // Webcam
    this.video = null;
    this.videoTex = null;
    this.stream = null;

    // Scene source
    this.renderTarget = null;

    // Upload source
    this.uploadTex = null;

    this.source = "webcam"; // "webcam" | "scene" | "upload"
    this.currentTexture = null;

    // Surfaces created from detected contours or manual calibration
    this.surfaces = [];

    // 4-point calibration — corners in NDC [-1,1]
    this.corners = [
      [-0.6,  0.35],
      [ 0.6,  0.35],
      [ 0.6, -0.35],
      [-0.6, -0.35],
    ];
    this.calibrationGroup = new THREE.Group();
    this.calibrationMesh = null;

    // OpenCV + projected-material handles
    this.cv = null;
    this.ProjectedMaterial = null;

    // detect-every-N-frames bookkeeping
    this._frameCount = 0;
    this._lastDetectPolys = [];
    // Throttle scene-source RT copy: do it every `sceneCopyEveryN` frames
    // instead of every frame to cut the render cost in half. At 60 fps a
    // value of 2 means the projection texture updates at 30 fps which is
    // imperceptible on static geometry.
    this._sceneCopyEveryN = 2;

    // UI handles
    this._cornerDots = [];

    // Dispose/init race guard — if dispose() is called while init() is still
    // awaiting CDN loads, we flip this flag and init() bails before touching
    // the scene graph.
    this._disposed = false;
    this._initPromise = null;
  }

  async init({ scene, camera, renderer, composer, holder }) {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      this.scene = scene;
      this.camera = camera;
      this.renderer = renderer;
      this.composer = composer;
      this.holder = holder;

      // Dedicated projector camera — same aspect as viewport, narrower FOV to
      // emulate a real projector cone. Asymmetric frustum is applied from the
      // 4-corner calibration (same math lifted from head_tracking.js).
      const aspect = holder.clientWidth / Math.max(1, holder.clientHeight);
      this.projector = new THREE.PerspectiveCamera(35, aspect, 0.1, 100);
      this.projector.position.set(0, 0, 5);
      this.projector.lookAt(0, 0, 0);
      if (!this._disposed) scene.add(this.projector);

      // Only load three-projected-material on init (small, needed for the
      // calibration mesh material). OpenCV.js is ~10 MB and was blocking the
      // main thread for 2-5 seconds; defer it to the first scan via
      // _ensureCV() instead.
      const ProjectedMaterial = await loadProjectedMaterial();
      if (this._disposed) return false; // dispose() won the race
      this.ProjectedMaterial = ProjectedMaterial;
      // this.cv stays null until first detection call.

      // Add the calibration quad to the scene (starts off hidden until a
      // source is set).
      scene.add(this.calibrationGroup);
      this._rebuildCalibrationMesh();
      return true;
    })();
    return this._initPromise;
  }

  // --- Source switching ----------------------------------------------------
  async setSource(kind, payload) {
    this.source = kind;
    if (kind === "webcam") {
      await this._ensureWebcam();
      this.currentTexture = this.videoTex;
    } else if (kind === "scene") {
      this._ensureRenderTarget();
      this.currentTexture = this.renderTarget.texture;
    } else if (kind === "upload" && payload) {
      await this._loadUploadTexture(payload);
      this.currentTexture = this.uploadTex;
    }
    if (this.calibrationMesh && this.currentTexture) {
      this.calibrationMesh.material.setTexture(this.currentTexture);
      this.calibrationMesh.material.project(this.calibrationMesh);
    }
    return true;
  }

  async _ensureWebcam() {
    if (this.video) return;
    // Dispose any prior VideoTexture left over from a previous setSource
    // lifecycle (user toggling webcam→scene→webcam).
    this.videoTex?.dispose?.();
    this.videoTex = null;
    // Use the SHARED webcam stream so face + hand + projection all run on
    // one getUserMedia grant. Lazy import to keep this module standalone.
    const wc = await import("./webcam.js");
    const { video, stream } = await wc.getSharedWebcam("projection-mode");
    this.video = video;
    this.stream = stream;
    this.videoTex = new THREE.VideoTexture(this.video);
    this.videoTex.colorSpace = THREE.SRGBColorSpace;
  }

  _ensureRenderTarget() {
    const q = (typeof window !== "undefined" && window.__quality) || {};
    const r = q.projectorResolution || 1024;
    if (this.renderTarget && this.renderTarget.width === r) return;
    this.renderTarget?.dispose?.();
    this.renderTarget = new THREE.WebGLRenderTarget(r, r, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  async _loadUploadTexture(fileOrUrl) {
    const url = typeof fileOrUrl === "string" ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.uploadTex?.dispose?.();
    this.uploadTex = tex;
  }

  // --- Calibration ---------------------------------------------------------
  // corners: [[ndcX, ndcY] x4]
  setCorners(corners) {
    this.corners = corners.map(([x, y]) => [x, y]);
    this._rebuildCalibrationMesh();
    if (this.currentTexture) {
      this.calibrationMesh.material.project(this.calibrationMesh);
    }
  }

  _rebuildCalibrationMesh() {
    // Build a quad in projector-local space whose 4 NDC corners match this.corners.
    // Unproject each corner from NDC → world using the projector cam.
    if (!this.projector) return;
    const group = this.calibrationGroup;
    // Dispose previous (geometry + wrapper.material — wrapper was being leaked here before).
    if (this.calibrationMesh) {
      group.remove(this.calibrationMesh);
      this.calibrationMesh.geometry.dispose();
      this.calibrationMesh.userData.projectionWrapper?.dispose?.();
    }
    const pts = this.corners.map(([x, y]) => {
      const v = new THREE.Vector3(x, y, 0.9);
      v.unproject(this.projector);
      return v;
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      pts[0].x, pts[0].y, pts[0].z,
      pts[1].x, pts[1].y, pts[1].z,
      pts[2].x, pts[2].y, pts[2].z,
      pts[3].x, pts[3].y, pts[3].z,
    ]), 3));
    geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
      0, 1,  1, 1,  1, 0,  0, 0,
    ]), 2));
    geom.setIndex([0, 1, 2, 0, 2, 3]);
    geom.computeVertexNormals();

    const wrap = this.ProjectedMaterial
      ? new ProjectionMaterialWrapper(this.ProjectedMaterial, {
          camera: this.projector,
          texture: this.currentTexture || null,
        })
      : { material: new THREE.MeshBasicMaterial({ color: 0x5566ff, wireframe: true, transparent: true, opacity: 0.35 }), project() {}, setTexture() {}, dispose() {} };
    const mesh = new THREE.Mesh(geom, wrap.material);
    mesh.userData.projectionWrapper = wrap;
    group.add(mesh);
    this.calibrationMesh = mesh;
  }

  // Lazy-load OpenCV.js the first time a user-triggered scan needs it.
  // Loading the ~10 MB WASM during init() was blocking the main thread for
  // 2-5 s and freezing the page on first paint.
  async _ensureCV() {
    if (this.cv) return this.cv;
    try {
      this.cv = await loadOpenCV();
    } catch (e) {
      console.warn("[projection] OpenCV failed to load:", e);
      throw e;
    }
    return this.cv;
  }

  // --- Contour detection ---------------------------------------------------
  // Sync because it's called from the per-frame tick(); the early `!this.cv`
  // guard means it just returns [] until the user triggers an explicit scan
  // (which lazy-loads OpenCV via _ensureCV).
  detectContours() {
    if (!this.cv || !this.video) return [];
    const cv = this.cv;
    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    if (!w || !h) return [];
    const cap = new cv.VideoCapture(this.video);
    const frame = new cv.Mat(h, w, cv.CV_8UC4);
    try { cap.read(frame); } catch (_) { frame.delete(); return this._lastDetectPolys; }
    const gray = new cv.Mat();
    cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    const edges = new cv.Mat();
    cv.Canny(gray, edges, 60, 140);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const polys = [];
    const minArea = (w * h) * 0.005;
    for (let i = 0; i < contours.size() && polys.length < 8; i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < minArea) { c.delete(); continue; }
      const approx = new cv.Mat();
      const peri = cv.arcLength(c, true);
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      const poly = [];
      for (let j = 0; j < approx.rows; j++) {
        const x = approx.data32S[j * 2];
        const y = approx.data32S[j * 2 + 1];
        poly.push([x / w * 2 - 1, -(y / h * 2 - 1)]);
      }
      approx.delete(); c.delete();
      if (poly.length >= 3) polys.push(poly);
    }
    frame.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
    this._lastDetectPolys = polys;
    return polys;
  }

  // Takes detected polys and turns them into surfaces with the projection
  // material applied. Each surface is added to this.surfaces + scene.
  createSurfacesFromContours(polys) {
    this.clearSurfaces();
    for (const poly of polys) {
      const surf = this._surfaceFromPolygon(poly);
      if (surf) { this.scene.add(surf); this.surfaces.push(surf); }
    }
  }

  _surfaceFromPolygon(poly, opts = {}) {
    if (!poly || poly.length < 3) return null;
    // Triangle fan around centroid, unprojected from NDC to world.
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const verts = [[cx, cy]].concat(poly);
    const worldVerts = verts.map(([x, y]) => {
      const v = new THREE.Vector3(x, y, 0.9);
      v.unproject(this.projector);
      return v;
    });
    const positions = [];
    for (let i = 1; i < worldVerts.length; i++) {
      const a = worldVerts[0];
      const b = worldVerts[i];
      const c = worldVerts[(i % (worldVerts.length - 1)) + 1];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geom.computeVertexNormals();
    const source = opts.source || "empty";
    const initialTexture = source === "empty" ? null : (opts.texture ?? this.currentTexture);
    const wrap = new ProjectionMaterialWrapper(this.ProjectedMaterial, {
      camera: this.projector,
      texture: initialTexture,
    });
    // Let empty surfaces show as a translucent wireframe so the user can see
    // where they are before assigning a video.
    if (source === "empty") {
      wrap.material.transparent = true;
      wrap.material.opacity = 0.35;
      wrap.material.wireframe = true;
    }
    const mesh = new THREE.Mesh(geom, wrap.material);
    mesh.userData.projectionWrapper = wrap;
    mesh.userData.polygon = poly;
    mesh.userData.surfaceId = opts.id || `s-${Math.random().toString(36).slice(2, 7)}`;
    mesh.userData.name = opts.name || this._labelForPolygon(poly);
    mesh.userData.source = source;
    mesh.userData.uri = opts.uri || null;
    mesh.userData.texture = initialTexture;
    mesh.userData.videoEl = null;
    mesh.visible = source !== "empty" ? true : true; // keep placeholder visible too
    wrap.project(mesh);
    return mesh;
  }

  clearSurfaces() {
    for (const s of this.surfaces) {
      this._disposeSurfaceAssets(s);
      this.scene.remove(s);
      s.geometry?.dispose();
      s.userData.projectionWrapper?.dispose();
    }
    this.surfaces = [];
  }

  // Free any per-surface texture / video element so we don't leak when the
  // surface is removed or its source is swapped.
  _disposeSurfaceAssets(surface) {
    const ud = surface?.userData;
    if (!ud) return;
    if (ud.videoEl) {
      try { ud.videoEl.pause(); ud.videoEl.srcObject = null; ud.videoEl.src = ""; } catch (_) {}
      ud.videoEl.remove?.();
      ud.videoEl = null;
    }
    // Don't dispose shared textures (this.videoTex / this.renderTarget.texture).
    if (ud.texture && ud.texture !== this.videoTex && ud.texture !== this.renderTarget?.texture && ud.texture !== this.uploadTex) {
      try { ud.texture.dispose(); } catch (_) {}
    }
    ud.texture = null;
  }

  // ---------- v3 multi-surface AI scan ------------------------------------
  // Detects candidate rectangular regions via Canny → HoughLinesP →
  // intersect horizontal/vertical line groups. Falls back to detectContours()
  // if fewer than 2 rectangles found. Returns normalized-device-coord polygons
  // so they plug directly into `_surfaceFromPolygon`.
  async detectSurfacesAI() {
    if (!this.video) return [];
    try { await this._ensureCV(); } catch (_) { return []; }
    const cv = this.cv;
    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    if (!w || !h) return [];

    const cap = new cv.VideoCapture(this.video);
    const frame = new cv.Mat(h, w, cv.CV_8UC4);
    try { cap.read(frame); } catch (_) { frame.delete(); return this.detectContours(); }

    const gray = new cv.Mat();
    const edges = new cv.Mat();
    const dilKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    const lines = new cv.Mat();

    try {
      cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
      cv.Canny(gray, edges, 50, 150);
      cv.dilate(edges, edges, dilKernel, new cv.Point(-1, -1), 1);
      cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 50, 80, 20);

      // Split into horizontal / vertical groups (±5°).
      const h5 = 5 * Math.PI / 180;
      const hLines = [], vLines = [];
      for (let i = 0; i < lines.rows; i++) {
        const x1 = lines.data32S[i * 4];
        const y1 = lines.data32S[i * 4 + 1];
        const x2 = lines.data32S[i * 4 + 2];
        const y2 = lines.data32S[i * 4 + 3];
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const a = Math.abs(ang);
        if (a < h5 || Math.PI - a < h5) {
          hLines.push({ x1, y1, x2, y2, y: (y1 + y2) * 0.5 });
        } else if (Math.abs(a - Math.PI / 2) < h5) {
          vLines.push({ x1, y1, x2, y2, x: (x1 + x2) * 0.5 });
        }
      }
      // Merge collinear within 15 px.
      const merge = (arr, key) => {
        arr.sort((a, b) => a[key] - b[key]);
        const out = [];
        for (const L of arr) {
          const prev = out[out.length - 1];
          if (prev && Math.abs(L[key] - prev[key]) < 15) {
            prev.x1 = Math.min(prev.x1, L.x1);
            prev.y1 = Math.min(prev.y1, L.y1);
            prev.x2 = Math.max(prev.x2, L.x2);
            prev.y2 = Math.max(prev.y2, L.y2);
          } else out.push({ ...L });
        }
        return out;
      };
      const H = merge(hLines, "y");
      const V = merge(vLines, "x");

      // Candidate rectangles by picking pairs of H and pairs of V.
      const minArea = w * h * 0.03;
      const maxArea = w * h * 0.5;
      const rects = [];
      const takeH = H.slice(0, 8), takeV = V.slice(0, 8);
      for (let i = 0; i < takeH.length; i++) {
        for (let j = i + 1; j < takeH.length; j++) {
          for (let k = 0; k < takeV.length; k++) {
            for (let l = k + 1; l < takeV.length; l++) {
              const top = Math.min(takeH[i].y, takeH[j].y);
              const bot = Math.max(takeH[i].y, takeH[j].y);
              const lft = Math.min(takeV[k].x, takeV[l].x);
              const rgt = Math.max(takeV[k].x, takeV[l].x);
              const rw = rgt - lft, rh = bot - top;
              if (rw < 20 || rh < 20) continue;
              const area = rw * rh;
              if (area < minArea || area > maxArea) continue;
              const ar = rw / rh;
              if (ar < 0.2 || ar > 5.0) continue;
              rects.push({ lft, top, rgt, bot, area, cx: (lft + rgt) * 0.5, cy: (top + bot) * 0.5 });
            }
          }
        }
      }
      // Dedup rectangles with similar centroids.
      rects.sort((a, b) => b.area - a.area);
      const keep = [];
      for (const r of rects) {
        if (keep.length >= 8) break;
        const dup = keep.some(k => Math.hypot(k.cx - r.cx, k.cy - r.cy) < 30);
        if (!dup) keep.push(r);
      }

      const polys = keep.map(r => [
        [ (r.lft / w) * 2 - 1, -((r.top / h) * 2 - 1) ],
        [ (r.rgt / w) * 2 - 1, -((r.top / h) * 2 - 1) ],
        [ (r.rgt / w) * 2 - 1, -((r.bot / h) * 2 - 1) ],
        [ (r.lft / w) * 2 - 1, -((r.bot / h) * 2 - 1) ],
      ]);

      if (polys.length >= 2) return polys;
    } finally {
      frame.delete(); gray.delete(); edges.delete(); dilKernel.delete(); lines.delete();
    }
    // Fallback: use the legacy contour path which gives organic shapes.
    return this.detectContours();
  }

  // Detailed hierarchical scan — after the coarse AI pass, dive into each
  // detected rectangle and try to find smaller panels inside it (window panes
  // inside a window, brick sections inside a wall). Produces up to 24 total
  // surfaces with deduplication against already-known polygons.
  async detectDetailedSurfaces() {
    if (!this.video) return [];
    try { await this._ensureCV(); } catch (_) { return []; }
    const cv = this.cv;
    // Start with the coarse pass — needs at least 1 base rect to drill into.
    const base = await this.detectSurfacesAI();
    if (!base.length) return base;

    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    const cap = new cv.VideoCapture(this.video);
    const frame = new cv.Mat(h, w, cv.CV_8UC4);
    try { cap.read(frame); } catch (_) { frame.delete(); return base; }

    const gray = new cv.Mat();
    const allRects = [...base];

    try {
      cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);

      // For each base rectangle, crop to its ROI in pixel-space and run
      // Canny+Hough at lower thresholds to catch smaller features inside it.
      for (const poly of base) {
        const xs = poly.map(p => (p[0] + 1) * 0.5 * w);
        const ys = poly.map(p => (1 - p[1]) * 0.5 * h);
        const x0 = Math.max(0, Math.floor(Math.min(...xs)));
        const x1 = Math.min(w, Math.ceil(Math.max(...xs)));
        const y0 = Math.max(0, Math.floor(Math.min(...ys)));
        const y1 = Math.min(h, Math.ceil(Math.max(...ys)));
        const rw = x1 - x0, rh = y1 - y0;
        if (rw < 60 || rh < 60) continue; // too small to subdivide usefully

        const roiRect = new cv.Rect(x0, y0, rw, rh);
        const roi = gray.roi(roiRect);
        const edges = new cv.Mat();
        const lines = new cv.Mat();
        const dilKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
        try {
          cv.Canny(roi, edges, 30, 90); // lower thresholds for finer detail
          cv.dilate(edges, edges, dilKernel, new cv.Point(-1, -1), 1);
          cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 25, Math.max(20, Math.floor(Math.min(rw, rh) * 0.25)), 10);

          const h5 = 5 * Math.PI / 180;
          const H = [], V = [];
          for (let i = 0; i < lines.rows; i++) {
            const x1r = lines.data32S[i * 4];
            const y1r = lines.data32S[i * 4 + 1];
            const x2r = lines.data32S[i * 4 + 2];
            const y2r = lines.data32S[i * 4 + 3];
            const ang = Math.atan2(y2r - y1r, x2r - x1r);
            const a = Math.abs(ang);
            if (a < h5 || Math.PI - a < h5) H.push({ y: (y1r + y2r) * 0.5 });
            else if (Math.abs(a - Math.PI / 2) < h5) V.push({ x: (x1r + x2r) * 0.5 });
          }
          H.sort((a, b) => a.y - b.y);
          V.sort((a, b) => a.x - b.x);
          // Merge close lines (within 8 px in ROI space).
          const merge1D = (arr, key) => {
            const out = [];
            for (const e of arr) {
              const prev = out[out.length - 1];
              if (prev && Math.abs(e[key] - prev[key]) < 8) continue;
              out.push(e);
            }
            return out;
          };
          const Hm = merge1D(H, "y").slice(0, 6);
          const Vm = merge1D(V, "x").slice(0, 6);

          for (let i = 0; i < Hm.length; i++) {
            for (let j = i + 1; j < Hm.length; j++) {
              for (let k = 0; k < Vm.length; k++) {
                for (let l = k + 1; l < Vm.length; l++) {
                  const top = Math.min(Hm[i].y, Hm[j].y);
                  const bot = Math.max(Hm[i].y, Hm[j].y);
                  const lft = Math.min(Vm[k].x, Vm[l].x);
                  const rgt = Math.max(Vm[k].x, Vm[l].x);
                  const sw = rgt - lft, sh = bot - top;
                  if (sw < 20 || sh < 20) continue;
                  if (sw / rw > 0.92 && sh / rh > 0.92) continue; // same as parent — skip
                  const absTop = y0 + top, absBot = y0 + bot;
                  const absLft = x0 + lft, absRgt = x0 + rgt;
                  const sub = [
                    [ (absLft / w) * 2 - 1, -((absTop / h) * 2 - 1) ],
                    [ (absRgt / w) * 2 - 1, -((absTop / h) * 2 - 1) ],
                    [ (absRgt / w) * 2 - 1, -((absBot / h) * 2 - 1) ],
                    [ (absLft / w) * 2 - 1, -((absBot / h) * 2 - 1) ],
                  ];
                  if (!_polyOverlapsAny(sub, allRects, 0.7)) allRects.push(sub);
                }
              }
            }
          }
        } finally {
          roi.delete(); edges.delete(); lines.delete(); dilKernel.delete();
        }
        if (allRects.length >= 24) break;
      }
    } finally {
      frame.delete(); gray.delete();
    }
    return allRects.slice(0, 24);
  }

  // Luminance-aware mapping — split the camera frame into DARK and LIGHT
  // polygon regions. Ideal for painting/artwork mapping: the user can assign
  // shadow videos to dark regions and glow videos to bright regions so the
  // painting "comes alive" matching its own value structure.
  //
  // Process: grayscale → adaptive threshold (dark) + Otsu threshold (light)
  // → morphological close → findContours → approxPolyDP → return labelled
  // polygons with `tag: "dark" | "light"`.
  async detectLuminanceRegions() {
    if (!this.video) return [];
    try { await this._ensureCV(); } catch (_) { return []; }
    const cv = this.cv;
    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    if (!w || !h) return [];
    const cap = new cv.VideoCapture(this.video);
    const frame = new cv.Mat(h, w, cv.CV_8UC4);
    try { cap.read(frame); } catch (_) { frame.delete(); return []; }

    const gray = new cv.Mat();
    const darkMask = new cv.Mat();
    const lightMask = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
    const results = [];

    try {
      cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

      // DARK regions: pixels significantly below median via adaptive threshold.
      cv.adaptiveThreshold(gray, darkMask, 255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 21, 10);
      cv.morphologyEx(darkMask, darkMask, cv.MORPH_CLOSE, kernel);

      // LIGHT regions: Otsu threshold = auto bright/dark split.
      cv.threshold(gray, lightMask, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      cv.morphologyEx(lightMask, lightMask, cv.MORPH_CLOSE, kernel);

      const minArea = w * h * 0.02;
      const extractPolys = (mask, tag, limit) => {
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        try {
          cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
          const picks = [];
          for (let i = 0; i < contours.size(); i++) {
            const c = contours.get(i);
            const area = cv.contourArea(c);
            if (area < minArea) { c.delete(); continue; }
            const approx = new cv.Mat();
            const peri = cv.arcLength(c, true);
            cv.approxPolyDP(c, approx, 0.015 * peri, true);
            const poly = [];
            for (let j = 0; j < approx.rows; j++) {
              const x = approx.data32S[j * 2];
              const y = approx.data32S[j * 2 + 1];
              poly.push([x / w * 2 - 1, -(y / h * 2 - 1)]);
            }
            approx.delete(); c.delete();
            if (poly.length >= 3) picks.push({ poly, area, tag });
          }
          picks.sort((a, b) => b.area - a.area);
          for (const p of picks.slice(0, limit)) results.push(p);
        } finally {
          contours.delete(); hierarchy.delete();
        }
      };
      extractPolys(darkMask, "dark", 6);
      extractPolys(lightMask, "light", 6);
    } finally {
      frame.delete(); gray.delete(); darkMask.delete(); lightMask.delete(); kernel.delete();
    }

    return results; // [{ poly, tag, area }]
  }

  // Create surfaces from luminance scan, tagging each by "dark" or "light".
  createSurfacesFromLuminance(regions) {
    this.clearSurfaces();
    for (let i = 0; i < regions.length; i++) {
      const { poly, tag } = regions[i];
      const surf = this._surfaceFromPolygon(poly, {
        id: `l-${tag}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        name: `${tag === "dark" ? "Shadow" : "Light"} region ${i + 1}`,
        source: "empty",
      });
      if (surf) {
        surf.userData.tag = tag;
        this.scene.add(surf);
        this.surfaces.push(surf);
      }
    }
    return this.getSurfaces();
  }

  // Per-surface pro controls — opacity, tint, blend mode, "faux-3D" (emboss).
  // blend: "normal" | "additive" | "multiply" | "screen" | "subtract"
  setSurfaceOpacity(id, opacity) {
    const s = this._surfaceById(id);
    if (!s?.material) return;
    s.material.transparent = opacity < 1;
    s.material.opacity = Math.max(0, Math.min(1, opacity));
    s.material.needsUpdate = true;
  }
  setSurfaceTint(id, hex) {
    const s = this._surfaceById(id);
    if (!s?.material?.color) return;
    s.material.color.set(hex || 0xffffff);
  }
  setSurfaceBlend(id, blend) {
    const s = this._surfaceById(id);
    if (!s?.material) return;
    const map = {
      normal:   THREE.NormalBlending,
      additive: THREE.AdditiveBlending,
      multiply: THREE.MultiplyBlending,
      screen:   THREE.CustomBlending,
      subtract: THREE.SubtractiveBlending,
    };
    s.material.blending = map[blend] ?? THREE.NormalBlending;
    if (blend === "screen") {
      // Custom screen: 1 - (1 - src) * (1 - dst)
      s.material.blendSrc = THREE.OneMinusDstColorFactor;
      s.material.blendDst = THREE.OneFactor;
      s.material.blendEquation = THREE.AddEquation;
    }
    s.material.needsUpdate = true;
  }
  // Faux-3D: enable a luminance-driven normal-map effect so flat projections
  // look sculpted. Implemented by cloning the surface texture through a small
  // shader that derives a bump from brightness gradient. Low cost.
  setSurfaceFaux3D(id, on) {
    const s = this._surfaceById(id);
    if (!s) return;
    if (on && !s.userData._faux3DEnabled) {
      const wrap = s.userData.projectionWrapper;
      const mat = wrap?.material;
      if (!mat) return;
      // Attach an onBeforeCompile hook that adds emboss via dFdx/dFdy of luma.
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <output_fragment>",
          `
          float __lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
          vec2 __g = vec2(dFdx(__lum), dFdy(__lum));
          float __emboss = clamp(0.5 + (__g.x - __g.y) * 12.0, 0.0, 1.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * (0.6 + 0.8 * __emboss), 0.55);
          #include <output_fragment>
          `
        );
      };
      mat.needsUpdate = true;
      s.userData._faux3DEnabled = true;
    } else if (!on && s.userData._faux3DEnabled) {
      // Disable by removing the hook and re-compile.
      const wrap = s.userData.projectionWrapper;
      if (wrap?.material) {
        wrap.material.onBeforeCompile = () => {};
        wrap.material.needsUpdate = true;
      }
      s.userData._faux3DEnabled = false;
    }
  }

  // Manually add a user-drawn polygon as a new surface. `polyNdc` is an array
  // of [x, y] in NDC ([-1, 1]) coordinates — matches the output of
  // detectSurfacesAI.
  addManualSurface(polyNdc) {
    if (!polyNdc || polyNdc.length < 3) return null;
    const surf = this._surfaceFromPolygon(polyNdc, {
      id: `m-${Math.random().toString(36).slice(2, 7)}`,
      name: `Manual ${this.surfaces.length + 1}`,
      source: "empty",
    });
    if (surf) { this.scene.add(surf); this.surfaces.push(surf); }
    return surf ? this.getSurfaces().find(s => s.id === surf.userData.surfaceId) : null;
  }

  // Remove a single surface by id (user clicked trash in surface list).
  removeSurface(id) {
    const idx = this.surfaces.findIndex(s => s.userData.surfaceId === id);
    if (idx < 0) return false;
    const s = this.surfaces[idx];
    this._disposeSurfaceAssets(s);
    this.scene.remove(s);
    s.geometry?.dispose();
    s.userData.projectionWrapper?.dispose();
    this.surfaces.splice(idx, 1);
    return true;
  }

  // Batch-randomize: assign a random preset video to every empty surface.
  async randomizePresets() {
    const empties = this.surfaces.filter(s => (s.userData.source || "empty") === "empty");
    const shuffled = [...PRESETS].sort(() => Math.random() - 0.5);
    for (let i = 0; i < empties.length; i++) {
      const preset = shuffled[i % shuffled.length];
      try { await this.assignToSurface(empties[i].userData.surfaceId, { source: "video", uri: preset.uri }); }
      catch (_) { /* individual failure shouldn't abort whole randomize */ }
    }
  }

  // Per-surface playback control.
  playSurface(id) {
    const s = this._surfaceById(id);
    if (s?.userData.videoEl) s.userData.videoEl.play().catch(() => {});
  }
  pauseSurface(id) {
    const s = this._surfaceById(id);
    if (s?.userData.videoEl) s.userData.videoEl.pause();
  }
  isPlaying(id) {
    const s = this._surfaceById(id);
    const v = s?.userData.videoEl;
    return !!(v && !v.paused && !v.ended);
  }

  // Label polygons by centroid quadrant → "top-left", "center", etc.
  _labelForPolygon(poly) {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const hz = cx < -0.33 ? "Left" : cx > 0.33 ? "Right" : "Center";
    const vt = cy > 0.33 ? "Top" : cy < -0.33 ? "Bottom" : "Middle";
    return `${vt} ${hz}`;
  }

  // Build surfaces from AI-detected polys, each with its own identity + empty
  // source. User then taps a surface and assigns a video via assignToSurface.
  createSurfacesFromAI(polys) {
    this.clearSurfaces();
    for (let i = 0; i < polys.length; i++) {
      const surf = this._surfaceFromPolygon(polys[i], {
        id: `s${i}-${Math.random().toString(36).slice(2, 7)}`,
        name: this._labelForPolygon(polys[i]),
        source: "empty",
      });
      if (surf) { this.scene.add(surf); this.surfaces.push(surf); }
    }
    return this.getSurfaces();
  }

  getSurfaces() {
    return this.surfaces.map(s => ({
      id: s.userData.surfaceId,
      name: s.userData.name,
      source: s.userData.source || "empty",
      uri: s.userData.uri || null,
      polygon: s.userData.polygon,
    }));
  }

  // Resolve a surface mesh by stable id.
  _surfaceById(id) {
    return this.surfaces.find(s => s.userData.surfaceId === id) || null;
  }

  // Visual selection — briefly tints the surface for feedback.
  selectSurface(id) {
    for (const s of this.surfaces) {
      s.userData.selected = s.userData.surfaceId === id;
      if (s.material) s.material.opacity = s.userData.selected ? 1.0 : 0.95;
    }
    return this._surfaceById(id);
  }

  // Core per-surface assignment. source = "video" | "image" | "webcam" |
  // "scene" | "empty". uri is URL / blob / File for video|image.
  async assignToSurface(id, { source, uri, file } = {}) {
    const surf = this._surfaceById(id);
    if (!surf) throw new Error(`surface_not_found:${id}`);
    const wrap = surf.userData.projectionWrapper;
    if (!wrap) throw new Error(`no_wrapper:${id}`);

    // SECURITY (.audit/1-security/H2): scheme-check any per-surface uri before
    // it flows into <video src> / TextureLoader. file objects produce blob: URIs
    // we just created — those are safe. The unauth project-store means surfaces[]
    // arriving from /projection-project/{id} can carry attacker-controlled URIs.
    if (uri && !file) {
      const ok = /^https?:\/\//i.test(uri) || /^blob:/i.test(uri);
      if (!ok) throw new Error(`unsafe_uri:${String(uri).slice(0, 40)}`);
      if (uri.length > 2048) throw new Error(`uri_too_long`);
    }

    // Dispose previous per-surface assets (video element + owned texture).
    this._disposeSurfaceAssets(surf);

    let tex = null;
    if (source === "video") {
      const actualUri = file ? URL.createObjectURL(file) : uri;
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.src = actualUri;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      Object.assign(video.style, { position: "fixed", left: "-9999px", width: "1px", height: "1px" });
      document.body.appendChild(video);
      try {
        await new Promise((resolve, reject) => {
          const done = () => { video.removeEventListener("error", onErr); resolve(); };
          const onErr = (e) => { video.removeEventListener("loadeddata", done); reject(new Error("video_load_failed")); };
          video.addEventListener("loadeddata", done, { once: true });
          video.addEventListener("error", onErr, { once: true });
        });
        await video.play().catch(() => { /* some browsers need a gesture */ });
      } catch (e) {
        video.remove();
        throw e;
      }
      tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      surf.userData.videoEl = video;
    } else if (source === "image") {
      const actualUri = file ? URL.createObjectURL(file) : uri;
      tex = await new THREE.TextureLoader().loadAsync(actualUri);
      tex.colorSpace = THREE.SRGBColorSpace;
    } else if (source === "webcam") {
      await this._ensureWebcam();
      tex = this.videoTex;
    } else if (source === "scene") {
      this._ensureRenderTarget();
      tex = this.renderTarget.texture;
    } else if (source === "empty") {
      tex = null;
    } else {
      throw new Error(`unknown_source:${source}`);
    }

    surf.userData.source = source;
    surf.userData.uri = uri || null;
    surf.userData.texture = tex;
    surf.visible = source !== "empty";
    wrap.setTexture(tex);
    wrap.project(surf);
    return this.getSurfaces().find(s => s.id === id);
  }

  // Play every video surface (user pressed Play).
  playAll() {
    for (const s of this.surfaces) {
      if (s.userData.source === "video" && s.userData.videoEl) {
        s.userData.videoEl.play().catch(() => {});
      }
    }
  }
  pauseAll() {
    for (const s of this.surfaces) {
      if (s.userData.source === "video" && s.userData.videoEl) {
        s.userData.videoEl.pause();
      }
    }
  }

  // --- Serialize / load ----------------------------------------------------
  serialize(name = "untitled") {
    return {
      name,
      calibration: { corners: this.corners.map(c => c.slice()) },
      surfaces: this.surfaces.map((s) => ({
        id: s.userData.surfaceId || null,
        name: s.userData.name || null,
        polygon: s.userData.polygon || null,
        source: s.userData.source || "empty",
        uri: s.userData.uri || null,
      })),
      content: { source: this.source },
    };
  }

  async saveToBackend(name, backend) {
    const body = this.serialize(name);
    const res = await fetch(`${backend}/projection-project`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`save_failed:${res.status}`);
    return res.json();
  }

  async loadFromBackend(pid, backend) {
    const res = await fetch(`${backend}/projection-project/${pid}`);
    if (!res.ok) throw new Error(`load_failed:${res.status}`);
    const { project } = await res.json();
    this.setCorners(project.calibration?.corners || this.corners);
    if (project.content?.source) await this.setSource(project.content.source);
    const saved = (project.surfaces || []).filter(s => s.polygon);
    if (saved.length) {
      // Build surfaces with stable IDs from the save.
      this.clearSurfaces();
      for (const s of saved) {
        const surf = this._surfaceFromPolygon(s.polygon, {
          id: s.id || `s-${Math.random().toString(36).slice(2, 7)}`,
          name: s.name || this._labelForPolygon(s.polygon),
          source: "empty",
        });
        if (surf) { this.scene.add(surf); this.surfaces.push(surf); }
      }
      // Re-apply per-surface source assignments.
      for (const s of saved) {
        if (!s.id || !s.source || s.source === "empty") continue;
        try { await this.assignToSurface(s.id, { source: s.source, uri: s.uri }); }
        catch (_) { /* individual assign failure shouldn't abort whole load */ }
      }
    }
    return project;
  }

  // --- Tick (called from animate()) ---------------------------------------
  tick() {
    const q = (typeof window !== "undefined" && window.__quality) || {};
    const detectN = q.detectEveryNFrames || 30;
    this._frameCount++;

    // 1. Refresh source texture if it's scene mode. Throttled: we only
    //    re-render the scene into the RT every N frames, so projection mode
    //    doesn't double the GPU cost.
    if (this.source === "scene" && this.renderTarget &&
        (this._frameCount % this._sceneCopyEveryN === 0)) {
      // Hide the calibration group + surfaces so the RT captures the "main"
      // scene only, not our projection overlay (prevents feedback).
      // Snapshot BEFORE the hide so restoration is always consistent, even if
      // `this.surfaces` mutates mid-frame.
      const surfacesSnapshot = this.surfaces.slice();
      const prevVisGroup = this.calibrationGroup.visible;
      const prevVisSurfaces = surfacesSnapshot.map((s) => s.visible);
      this.calibrationGroup.visible = false;
      surfacesSnapshot.forEach((s) => { s.visible = false; });
      try {
        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.render(this.scene, this.camera);
      } finally {
        this.renderer.setRenderTarget(null);
        this.calibrationGroup.visible = prevVisGroup;
        surfacesSnapshot.forEach((s, i) => { s.visible = prevVisSurfaces[i]; });
      }
    }

    // 2. Optional webcam-driven surface re-detect.
    if (this.source === "webcam" && this.video && this._frameCount % detectN === 0) {
      try {
        const polys = this.detectContours();
        if (polys.length && this.surfaces.length === 0) {
          this.createSurfacesFromContours(polys.slice(0, 1)); // MVP: first surface only
        }
      } catch (_) { /* opencv transient — ignore */ }
    }

    // 3. Mark every per-surface VideoTexture as needing a new upload. Cheap.
    for (const s of this.surfaces) {
      const t = s.userData.texture;
      if (t && t.isVideoTexture) t.needsUpdate = true;
    }

    // 4. Render the host composer (projector render happens as part of normal scene pass).
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // --- Calibration drag UI (DOM overlay) ----------------------------------
  // Creates 4 draggable dots on top of the canvas. `onChange` fires with new
  // NDC corners after each drag.
  mountCornerUI(container, onChange) {
    this.unmountCornerUI();
    const rect = () => container.getBoundingClientRect();
    const toPct = (ndcX, ndcY) => ({
      left: ((ndcX + 1) / 2) * 100,
      top:  ((1 - ndcY) / 2) * 100,
    });
    this.corners.forEach((c, i) => {
      const dot = document.createElement("div");
      dot.className = "projection-corner-dot";
      dot.dataset.idx = String(i);
      dot.style.cssText = `
        position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px;
        border-radius: 50%; background: #5cf; border: 2px solid #fff;
        cursor: grab; touch-action: none; pointer-events: auto; z-index: 20;`;
      const { left, top } = toPct(c[0], c[1]);
      dot.style.left = `${left}%`;
      dot.style.top = `${top}%`;
      container.appendChild(dot);
      this._cornerDots.push(dot);

      const onMove = (e) => {
        const r = rect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        const ndcX = x * 2 - 1;
        const ndcY = 1 - y * 2;
        this.corners[i] = [ndcX, ndcY];
        dot.style.left = `${x * 100}%`;
        dot.style.top = `${y * 100}%`;
        this._rebuildCalibrationMesh();
        if (this.currentTexture && this.calibrationMesh) {
          this.calibrationMesh.userData.projectionWrapper.project(this.calibrationMesh);
        }
        onChange?.(this.corners);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        dot.style.cursor = "grab";
      };
      dot.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        dot.style.cursor = "grabbing";
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    });
  }

  unmountCornerUI() {
    this._cornerDots.forEach((d) => d.remove());
    this._cornerDots = [];
  }

  // --- Dispose ------------------------------------------------------------
  dispose() {
    this._disposed = true;
    // Reset _initPromise so a fresh ProjectionMode instantiation is allowed
    // to init() again (e.g. user toggles out of project mode, then back in).
    this._initPromise = null;
    this.unmountCornerUI();
    // clearSurfaces already calls _disposeSurfaceAssets per-surface.
    this.clearSurfaces();
    if (this.calibrationMesh) {
      this.calibrationGroup.remove(this.calibrationMesh);
      this.calibrationMesh.geometry.dispose();
      this.calibrationMesh.material.dispose?.();
      this.calibrationMesh = null;
    }
    this.scene?.remove(this.calibrationGroup);
    if (this.projector) this.scene?.remove(this.projector);
    this.renderTarget?.dispose?.();
    this.videoTex?.dispose?.();
    this.uploadTex?.dispose?.();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.remove();
    this.stream = null;
    this.video = null;
    this.videoTex = null;
    this.uploadTex = null;
    this.renderTarget = null;
  }
}
