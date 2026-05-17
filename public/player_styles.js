// Style catalog for the standalone Player. Each style mutates the viewer
// (scene background, fog, bloom, lighting, optional DOM overlays) so the same
// projection project can be shown in wildly different moods.
//
// Shape:
//   { id, name, icon, apply({scene, renderer, composer, bloomPass, holder, projectionHandle}), cleanup(ctx) }
//
// The Player calls cleanup(prev) before apply(next) when switching.

import * as THREE from "three";

function addStarfield(scene) {
  const geom = new THREE.BufferGeometry();
  const N = 2000;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 50 + Math.random() * 150;
    const t = Math.random() * Math.PI * 2;
    const p = (Math.random() - 0.5) * Math.PI;
    pos[i * 3]     = r * Math.cos(t) * Math.cos(p);
    pos[i * 3 + 1] = r * Math.sin(p);
    pos[i * 3 + 2] = r * Math.sin(t) * Math.cos(p);
  }
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.45, sizeAttenuation: true, transparent: true, opacity: 0.9 });
  const pts = new THREE.Points(geom, mat);
  pts.userData.__playerStyle = "stars";
  scene.add(pts);
  return pts;
}

function overlayHTML(holder, html, className) {
  const div = document.createElement("div");
  div.className = `player-style-overlay ${className || ""}`;
  div.innerHTML = html;
  holder.appendChild(div);
  return div;
}

export const STYLES = {
  blacked: {
    id: "blacked", name: "Blacked out", icon: "⬛",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength };
      scene.background = new THREE.Color(0x000000);
      scene.fog = null;
      if (bloomPass) bloomPass.strength = 0.4;
      renderer.toneMappingExposure = 1.0;
      holder.style.background = "#000";
    },
    cleanup(ctx) {
      const { scene, bloomPass, holder } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      holder.style.background = "";
    },
  },

  minimal: {
    id: "minimal", name: "No frame", icon: "▫",
    apply(ctx) {
      const { scene, bloomPass } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength };
      scene.background = new THREE.Color(0x0a0a10);
      scene.fog = null;
      if (bloomPass) bloomPass.strength = 0.55;
    },
    cleanup(ctx) { STYLES.blacked.cleanup(ctx); },
  },

  space: {
    id: "space", name: "Space", icon: "🌌",
    apply(ctx) {
      const { scene, renderer, bloomPass } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength };
      scene.background = new THREE.Color(0x040418);
      scene.fog = new THREE.FogExp2(0x05051a, 0.015);
      ctx._stars = addStarfield(scene);
      if (bloomPass) bloomPass.strength = 1.2;
      renderer.toneMappingExposure = 1.35;
    },
    cleanup(ctx) {
      const { scene, renderer, bloomPass } = ctx;
      if (ctx._stars) { scene.remove(ctx._stars); ctx._stars.geometry.dispose(); ctx._stars.material.dispose(); ctx._stars = null; }
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = 1.3;
    },
  },

  scary: {
    id: "scary", name: "Scary", icon: "👻",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength, exp: renderer.toneMappingExposure };
      scene.background = new THREE.Color(0x0a0503);
      scene.fog = new THREE.FogExp2(0x1a0804, 0.05);
      if (bloomPass) bloomPass.strength = 0.6;
      renderer.toneMappingExposure = 0.75;
      // Film-grain + red vignette DOM overlay.
      ctx._overlay = overlayHTML(holder,
        `<div class="grain"></div><div class="vignette vignette-red"></div>`,
        "style-scary");
      // Random flicker
      ctx._flicker = setInterval(() => {
        renderer.toneMappingExposure = 0.55 + Math.random() * 0.4;
      }, 140);
    },
    cleanup(ctx) {
      clearInterval(ctx._flicker); ctx._flicker = null;
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, renderer, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = ctx._prev?.exp ?? 1.3;
    },
  },

  theater: {
    id: "theater", name: "Theater", icon: "🎭",
    apply(ctx) {
      const { scene, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength };
      scene.background = new THREE.Color(0x10060a);
      scene.fog = new THREE.FogExp2(0x22060a, 0.01);
      if (bloomPass) bloomPass.strength = 0.9;
      // Red velvet proscenium frame via DOM overlay.
      ctx._overlay = overlayHTML(holder,
        `<div class="theater-curtain theater-left"></div>
         <div class="theater-curtain theater-right"></div>
         <div class="theater-valance"></div>`,
        "style-theater");
    },
    cleanup(ctx) {
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
    },
  },

  framed: {
    id: "framed", name: "Gold frame", icon: "🖼️",
    apply(ctx) {
      const { scene, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength };
      scene.background = new THREE.Color(0x05050a);
      scene.fog = null;
      if (bloomPass) bloomPass.strength = 0.7;
      ctx._overlay = overlayHTML(holder,
        `<div class="goldframe"></div>`,
        "style-framed");
    },
    cleanup(ctx) {
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
    },
  },

  cinema: {
    id: "cinema", name: "Cinema", icon: "🎬",
    apply(ctx) {
      const { scene, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength };
      scene.background = new THREE.Color(0x000000);
      scene.fog = null;
      if (bloomPass) bloomPass.strength = 0.8;
      ctx._overlay = overlayHTML(holder,
        `<div class="cinebar cinebar-top"></div><div class="cinebar cinebar-bottom"></div><div class="vignette vignette-cool"></div>`,
        "style-cinema");
    },
    cleanup(ctx) {
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
    },
  },

  rave: {
    id: "rave", name: "Rave", icon: "✨",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength, exp: renderer.toneMappingExposure };
      scene.background = new THREE.Color(0x020208);
      scene.fog = new THREE.FogExp2(0x000010, 0.02);
      if (bloomPass) bloomPass.strength = 1.6;
      renderer.toneMappingExposure = 1.55;
      // Time-driven hue shift on fog color via interval.
      let t = 0;
      ctx._rave = setInterval(() => {
        t += 0.05;
        const hue = (Math.sin(t * 0.3) * 0.5 + 0.5) * 360;
        const col = new THREE.Color().setHSL((hue % 360) / 360, 0.8, 0.12);
        scene.background = col;
        if (scene.fog) scene.fog.color = new THREE.Color().setHSL((hue % 360) / 360, 0.9, 0.05);
      }, 80);
      ctx._overlay = overlayHTML(holder, `<div class="rave-flash"></div>`, "style-rave");
    },
    cleanup(ctx) {
      clearInterval(ctx._rave); ctx._rave = null;
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, renderer, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = ctx._prev?.exp ?? 1.3;
    },
  },

  vaporwave: {
    id: "vaporwave", name: "Vaporwave", icon: "🕶️",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength, exp: renderer.toneMappingExposure };
      scene.background = new THREE.Color(0x1a0a2e);
      scene.fog = new THREE.FogExp2(0x2d1b4e, 0.02);
      if (bloomPass) bloomPass.strength = 1.3;
      renderer.toneMappingExposure = 1.45;
      ctx._overlay = overlayHTML(holder,
        `<div class="vapor-grid"></div><div class="vapor-sun"></div><div class="vapor-scanlines"></div>`,
        "style-vaporwave");
    },
    cleanup(ctx) {
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, renderer, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = ctx._prev?.exp ?? 1.3;
    },
  },

  church: {
    id: "church", name: "Church", icon: "⛪",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength, exp: renderer.toneMappingExposure };
      scene.background = new THREE.Color(0x0a0506);
      scene.fog = new THREE.FogExp2(0x2a1205, 0.02);
      if (bloomPass) bloomPass.strength = 1.0;
      renderer.toneMappingExposure = 1.15;
      ctx._overlay = overlayHTML(holder,
        `<div class="church-stained church-left"></div><div class="church-stained church-right"></div><div class="church-candle church-candle-l"></div><div class="church-candle church-candle-r"></div>`,
        "style-church");
      // Candle flicker
      ctx._flicker = setInterval(() => {
        const els = ctx._overlay.querySelectorAll(".church-candle");
        els.forEach(e => { e.style.opacity = 0.6 + Math.random() * 0.4; });
      }, 180);
    },
    cleanup(ctx) {
      clearInterval(ctx._flicker); ctx._flicker = null;
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, renderer, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = ctx._prev?.exp ?? 1.3;
    },
  },

  gallery: {
    id: "gallery", name: "Gallery", icon: "🏛️",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength, exp: renderer.toneMappingExposure };
      scene.background = new THREE.Color(0xe9e6df);
      scene.fog = null;
      if (bloomPass) bloomPass.strength = 0.3;
      renderer.toneMappingExposure = 1.1;
      ctx._overlay = overlayHTML(holder,
        `<div class="gallery-floor"></div><div class="gallery-spotlight gal-l"></div><div class="gallery-spotlight gal-r"></div>`,
        "style-gallery");
    },
    cleanup(ctx) {
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, renderer, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = ctx._prev?.exp ?? 1.3;
    },
  },

  noir: {
    id: "noir", name: "Noir", icon: "🎞️",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength, exp: renderer.toneMappingExposure };
      scene.background = new THREE.Color(0x000000);
      scene.fog = null;
      if (bloomPass) bloomPass.strength = 0.55;
      renderer.toneMappingExposure = 0.85;
      ctx._overlay = overlayHTML(holder,
        `<div class="noir-desat"></div><div class="noir-grain"></div><div class="vignette"></div>`,
        "style-noir");
    },
    cleanup(ctx) {
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, renderer, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = ctx._prev?.exp ?? 1.3;
    },
  },

  aquarium: {
    id: "aquarium", name: "Aquarium", icon: "🐠",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength, exp: renderer.toneMappingExposure };
      scene.background = new THREE.Color(0x042034);
      scene.fog = new THREE.FogExp2(0x0a4866, 0.04);
      if (bloomPass) bloomPass.strength = 1.1;
      renderer.toneMappingExposure = 1.2;
      ctx._overlay = overlayHTML(holder,
        `<div class="aqua-caustics"></div><div class="aqua-bubbles"></div>`,
        "style-aquarium");
      // Bubbles emitter
      ctx._bubInt = setInterval(() => {
        const bub = document.createElement("div");
        bub.className = "aqua-bubble";
        bub.style.left = (Math.random() * 100) + "%";
        bub.style.width = (6 + Math.random() * 14) + "px";
        bub.style.animationDuration = (4 + Math.random() * 4) + "s";
        ctx._overlay.querySelector(".aqua-bubbles")?.appendChild(bub);
        setTimeout(() => bub.remove(), 8000);
      }, 400);
    },
    cleanup(ctx) {
      clearInterval(ctx._bubInt); ctx._bubInt = null;
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, renderer, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = ctx._prev?.exp ?? 1.3;
    },
  },

  glitch: {
    id: "glitch", name: "Glitch", icon: "📺",
    apply(ctx) {
      const { scene, renderer, bloomPass, holder } = ctx;
      ctx._prev = { bg: scene.background, fog: scene.fog, bloom: bloomPass?.strength, exp: renderer.toneMappingExposure };
      scene.background = new THREE.Color(0x000000);
      scene.fog = null;
      if (bloomPass) bloomPass.strength = 0.95;
      renderer.toneMappingExposure = 1.4;
      ctx._overlay = overlayHTML(holder,
        `<div class="glitch-rgb"></div><div class="glitch-bars"></div><div class="glitch-scan"></div>`,
        "style-glitch");
      // Random RGB-shift bursts
      ctx._jitter = setInterval(() => {
        const el = ctx._overlay.querySelector(".glitch-rgb");
        if (!el) return;
        el.style.transform = `translate(${(Math.random() - 0.5) * 6}px, ${(Math.random() - 0.5) * 4}px)`;
        el.style.opacity = Math.random() > 0.85 ? 0.85 : 0.25;
      }, 90);
    },
    cleanup(ctx) {
      clearInterval(ctx._jitter); ctx._jitter = null;
      ctx._overlay?.remove(); ctx._overlay = null;
      const { scene, renderer, bloomPass } = ctx;
      scene.background = ctx._prev?.bg ?? new THREE.Color(0x060612);
      scene.fog = ctx._prev?.fog ?? null;
      if (bloomPass && ctx._prev?.bloom !== undefined) bloomPass.strength = ctx._prev.bloom;
      renderer.toneMappingExposure = ctx._prev?.exp ?? 1.3;
    },
  },
};

export const STYLE_ORDER = [
  "blacked", "minimal", "space", "scary", "theater", "framed", "cinema", "rave",
  "vaporwave", "church", "gallery", "noir", "aquarium", "glitch",
];
