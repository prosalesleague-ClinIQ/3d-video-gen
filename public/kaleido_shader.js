// Kaleidoscope post-processing shader — mirror-fold + per-channel IOR dispersion.
// Wraps three/addons/postprocessing/ShaderPass.js to expose a compact Effect-like
// surface (`.pass`, `.uniforms.get(name).value`, `.setSize(w, h)`).
// Constructor throws if the WebGPU backend is active so callers can fall back
// to the clone-based kaleido path.

import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float segments;
uniform float rotation;
uniform float dispersion;
uniform vec2  center;
uniform vec2  aspect;
varying vec2 vUv;

vec4 sampleScene(vec2 uv) {
  return texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999)));
}

void main() {
  vec2 p = (vUv - center) * aspect;
  float r = length(p);
  float a = atan(p.y, p.x) + rotation;
  float slice = 6.28318530718 / max(segments, 1.0);
  a = mod(a, slice);
  a = abs(a - slice * 0.5);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 gUv = center + (dir * r) / aspect;
  vec2 rUv = center + (dir * (r + dispersion)) / aspect;
  vec2 bUv = center + (dir * (r - dispersion)) / aspect;
  float R = sampleScene(rUv).r;
  float G = sampleScene(gUv).g;
  float B = sampleScene(bUv).b;
  float A = sampleScene(gUv).a;
  float glow = 1.0 + 0.15 * (1.0 - clamp(r, 0.0, 1.0));
  gl_FragColor = vec4(vec3(R, G, B) * glow, A);
}
`;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export class KaleidoEffect {
  constructor(options = {}) {
    if (typeof window !== "undefined" && window.__renderBackend === "webgpu") {
      throw new Error("KaleidoEffect unavailable: WebGPU backend detected");
    }
    const segments = clamp(Number(options.segments) || 8, 2, 32);
    const dispersion = options.dispersion ?? 0.015;
    const centerX = options.centerX ?? 0.5;
    const centerY = options.centerY ?? 0.5;
    const w = options.width ?? 1;
    const h = options.height ?? 1;
    const aspectX = w >= h ? w / h : 1.0;
    const aspectY = h > w ? h / w : 1.0;

    const shader = {
      uniforms: {
        tDiffuse:   { value: null },
        segments:   { value: segments },
        rotation:   { value: 0.0 },
        dispersion: { value: dispersion },
        center:     { value: new THREE.Vector2(centerX, centerY) },
        aspect:     { value: new THREE.Vector2(aspectX, aspectY) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    };
    this.pass = new ShaderPass(shader, "tDiffuse");
    const u = this.pass.uniforms;
    this.uniforms = {
      get: (name) => u[name],
      set: (name, value) => { if (u[name]) u[name].value = value; },
    };
  }

  setSize(width, height) {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    const u = this.pass.uniforms.aspect.value;
    if (w >= h) { u.x = w / h; u.y = 1.0; }
    else        { u.x = 1.0;   u.y = h / w; }
    if (typeof this.pass.setSize === "function") this.pass.setSize(w, h);
  }

  dispose() {
    const mat = this.pass?.material;
    if (mat && typeof mat.dispose === "function") mat.dispose();
  }
}
