// Quality preset system — controls DPR, render scale, shadow map resolution,
// and feature flags for post-FX. Persists selection in localStorage.

export const PRESETS = {
  low:   { dpr: 1,   renderScale: 0.75, shadowMap: 1024, ssgi: false, hbao: false, traa: false, smaa: true,  bloomMip: false, sharpen: 0.4,  projectorResolution: 512,  detectEveryNFrames: 30 },
  med:   { dpr: 1.5, renderScale: 0.9,  shadowMap: 1024, ssgi: false, hbao: true,  traa: false, smaa: true,  bloomMip: true,  sharpen: 0.3,  projectorResolution: 1024, detectEveryNFrames: 15 },
  high:  { dpr: 2,   renderScale: 1.0,  shadowMap: 2048, ssgi: true,  hbao: true,  traa: true,  smaa: true,  bloomMip: true,  sharpen: 0.25, projectorResolution: 1024, detectEveryNFrames: 10 },
  ultra: { dpr: 3,   renderScale: 1.0,  shadowMap: 4096, ssgi: true,  hbao: true,  traa: true,  smaa: true,  bloomMip: true,  sharpen: 0.2,  projectorResolution: 2048, detectEveryNFrames: 5 },
};

export function getPreset(name) { return PRESETS[name] || PRESETS.high; }
export function loadPreset() { return localStorage.getItem("qualityPreset") || "high"; }
export function savePreset(name) { localStorage.setItem("qualityPreset", name); }

export function applyPreset(name, { renderer, composer, keyLight } = {}) {
  const p = getPreset(name);
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.dpr));
  }
  if (composer && typeof composer.setSize === "function" && renderer?.domElement) {
    const w = renderer.domElement.clientWidth * p.renderScale;
    const h = renderer.domElement.clientHeight * p.renderScale;
    composer.setSize(Math.floor(w), Math.floor(h));
  }
  if (keyLight && keyLight.shadow) {
    keyLight.shadow.mapSize.set(p.shadowMap, p.shadowMap);
    keyLight.shadow.map?.dispose?.();
    keyLight.shadow.map = null;
  }
  window.__quality = p;
  window.__qualityName = name;
  return p;
}
