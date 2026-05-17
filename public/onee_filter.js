// 1€ Filter — Casiez et al., CHI 2012.
// Adaptive low-pass filter: increases smoothing for slow movements (kills
// jitter) and decreases it for fast movements (no lag). Strict upgrade over
// fixed-α exponential smoothing.
//
// Direct port of `gestures/air_trackpad.py:_OneEuroFilter` from the
// Minority Report repo. Used by HandTracker for fingertip smoothing and
// (optionally) by HeadTracker to reduce face-pose jitter.

export class OneEuroFilter {
  constructor({ mincutoff = 1.5, beta = 0.05, dcutoff = 1.0 } = {}) {
    this.mincutoff = mincutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
    this._xPrev = null;
    this._dxPrev = 0;
    this._tPrev = null;
  }

  static _alpha(cutoff, te) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / Math.max(te, 1e-6));
  }

  call(x, t) {
    if (t == null) t = performance.now() / 1000;
    if (this._xPrev == null || this._tPrev == null) {
      this._xPrev = x;
      this._tPrev = t;
      return x;
    }
    const te = Math.max(t - this._tPrev, 1e-6);
    const dx = (x - this._xPrev) / te;
    const aD = OneEuroFilter._alpha(this.dcutoff, te);
    const edx = aD * dx + (1 - aD) * this._dxPrev;
    const cutoff = this.mincutoff + this.beta * Math.abs(edx);
    const a = OneEuroFilter._alpha(cutoff, te);
    const xs = a * x + (1 - a) * this._xPrev;
    this._xPrev = xs;
    this._dxPrev = edx;
    this._tPrev = t;
    return xs;
  }

  reset() { this._xPrev = null; this._dxPrev = 0; this._tPrev = null; }
}

// Convenience: make a vector filter (one OEF per axis).
export class OneEuroVec {
  constructor(dim = 2, opts) {
    this.filters = Array.from({ length: dim }, () => new OneEuroFilter(opts));
  }
  call(arr, t) { return arr.map((v, i) => this.filters[i].call(v, t)); }
  reset() { this.filters.forEach((f) => f.reset()); }
}
