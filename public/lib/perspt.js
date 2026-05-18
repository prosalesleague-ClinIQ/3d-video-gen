// perspt.js — 4-corner homography solver.
// Ported from p5.mapper-main/src/perspective/PerspT.js + numeric.js (MIT).
// Combines the original two files into one self-contained ES module by
// inlining ONLY the four numeric helpers actually used (inv / dotMMsmall /
// dotMV / transpose) plus their tiny prerequisites (dim, clone, identity,
// diag, rep, dotVV, _foreach2, cloneV). Trims ~150 LOC vs upstream.
//
// Usage:
//   import PerspT from "./lib/perspt.js";
//   const t = PerspT([srcX1,srcY1, srcX2,srcY2, srcX3,srcY3, srcX4,srcY4],
//                    [dstX1,dstY1, dstX2,dstY2, dstX3,dstY3, dstX4,dstY4]);
//   const [outX, outY] = t.transform(x, y);
//   const [inX,  inY ] = t.transformInverse(x, y);
//   // t.coeffs        // 9-element forward homography coefficients
//   // t.coeffsInv     // 9-element inverse coefficients
//
// To plug into a GLSL fragment shader as a uniform mat3, repack as:
//   const m = [
//     [coeffs[0], coeffs[1], coeffs[2]],
//     [coeffs[3], coeffs[4], coeffs[5]],
//     [coeffs[6], coeffs[7], coeffs[8]],   // coeffs[8] always 1
//   ];

// ---------- inlined numeric.js helpers --------------------------------------
const _numeric = (() => {
  const cloneV = (x) => { const n = x.length, ret = new Array(n); for (let i = n - 1; i !== -1; --i) ret[i] = x[i]; return ret; };
  const _foreach2 = (x, s, k, f) => {
    if (k === s.length - 1) return f(x);
    const n = s[k], ret = new Array(n);
    for (let i = n - 1; i >= 0; i--) ret[i] = _foreach2(x[i], s, k + 1, f);
    return ret;
  };
  const dim = (x) => {
    if (typeof x !== "object") return [];
    const y = x[0];
    if (typeof y !== "object") return [x.length];
    if (typeof y[0] !== "object") return [x.length, y.length];
    return _dim(x);
  };
  const _dim = (x) => { const ret = []; let y = x; while (Array.isArray(y)) { ret.push(y.length); y = y[0]; } return ret; };
  const clone = (x) => { if (typeof x !== "object") return x; return _foreach2(x, dim(x), 0, cloneV); };
  const rep = (s, v, k = 0) => {
    const n = s[k], ret = new Array(n);
    if (k === s.length - 1) { for (let i = 0; i < n; i++) ret[i] = v; return ret; }
    for (let i = 0; i < n; i++) ret[i] = rep(s, v, k + 1);
    return ret;
  };
  const diag = (d) => {
    const n = d.length, A = new Array(n);
    for (let i = 0; i < n; i++) { const Ai = new Array(n); for (let j = 0; j < n; j++) Ai[j] = (i === j) ? d[i] : 0; A[i] = Ai; }
    return A;
  };
  const identity = (n) => diag(rep([n], 1));
  const inv = (a) => {
    const s = dim(a), m = s[0], n = s[1];
    const A = clone(a), I = identity(m);
    for (let j = 0; j < n; ++j) {
      let i0 = -1, v0 = -1;
      for (let i = j; i !== m; ++i) {
        const k = Math.abs(A[i][j]);
        if (k > v0) { i0 = i; v0 = k; }
      }
      const Aj = A[i0]; A[i0] = A[j]; A[j] = Aj;
      const Ij = I[i0]; I[i0] = I[j]; I[j] = Ij;
      const x = Aj[j];
      for (let k = j; k !== n; ++k) Aj[k] /= x;
      for (let k = n - 1; k !== -1; --k) Ij[k] /= x;
      for (let i = m - 1; i !== -1; --i) {
        if (i !== j) {
          const Ai = A[i], Ii = I[i], xi = Ai[j];
          for (let k = j + 1; k !== n; ++k) Ai[k] -= Aj[k] * xi;
          for (let k = n - 1; k !== -1; --k) Ii[k] -= Ij[k] * xi;
        }
      }
    }
    return I;
  };
  const dotVV = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; };
  const dotMV = (x, y) => { const p = x.length, ret = new Array(p); for (let i = 0; i < p; i++) ret[i] = dotVV(x[i], y); return ret; };
  const dotMMsmall = (x, y) => {
    const p = x.length, q = y.length, r = y[0].length, ret = new Array(p);
    for (let i = 0; i < p; i++) {
      const foo = new Array(r);
      for (let k = 0; k < r; k++) { let w = 0; for (let j = 0; j < q; j++) w += x[i][j] * y[j][k]; foo[k] = w; }
      ret[i] = foo;
    }
    return ret;
  };
  const transpose = (x) => {
    const m = x.length, n = x[0].length, ret = new Array(n);
    for (let j = 0; j < n; j++) { const row = new Array(m); for (let i = 0; i < m; i++) row[i] = x[i][j]; ret[j] = row; }
    return ret;
  };
  return { inv, dotMMsmall, dotMV, transpose };
})();

// ---------- PerspT proper ---------------------------------------------------
function _round(num) { return Math.round(num * 1e10) / 1e10; }

function _coefficients(srcPts, dstPts, isInverse) {
  if (isInverse) { const tmp = dstPts; dstPts = srcPts; srcPts = tmp; }
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const sx = srcPts[i * 2], sy = srcPts[i * 2 + 1];
    const dx = dstPts[i * 2], dy = dstPts[i * 2 + 1];
    rows.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    rows.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
  }
  const matA = rows;
  const matB = dstPts;
  let matX;
  try {
    const aT = _numeric.transpose(matA);
    const inv = _numeric.inv(_numeric.dotMMsmall(aT, matA));
    const matD = _numeric.dotMMsmall(inv, aT);
    matX = _numeric.dotMV(matD, matB);
  } catch (e) {
    // Degenerate src/dst geometry — fall back to identity.
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  for (let i = 0; i < matX.length; i++) matX[i] = _round(matX[i]);
  matX[8] = 1;
  return matX;
}

export default function PerspT(srcPts, dstPts) {
  if (!(this instanceof PerspT)) return new PerspT(srcPts, dstPts);
  this.srcPts = srcPts;
  this.dstPts = dstPts;
  this.coeffs = _coefficients(srcPts, dstPts, false);
  this.coeffsInv = _coefficients(srcPts, dstPts, true);
  return this;
}

PerspT.prototype.transform = function (x, y) {
  const c = this.coeffs;
  const w = c[6] * x + c[7] * y + 1;
  return [(c[0] * x + c[1] * y + c[2]) / w, (c[3] * x + c[4] * y + c[5]) / w];
};

PerspT.prototype.transformInverse = function (x, y) {
  const c = this.coeffsInv;
  const w = c[6] * x + c[7] * y + 1;
  return [(c[0] * x + c[1] * y + c[2]) / w, (c[3] * x + c[4] * y + c[5]) / w];
};

// Pack as a 3×3 mat3 (row-major) — ready to pass to a GLSL uniform.
PerspT.prototype.toMat3 = function () {
  const c = this.coeffs;
  return [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], 1];
};

PerspT.prototype.toMat3Inverse = function () {
  const c = this.coeffsInv;
  return [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], 1];
};

export { PerspT };
