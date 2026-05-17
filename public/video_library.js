// Curated video library for Mapper + Player. Every URL is verified live with
// `Access-Control-Allow-Origin: *` (required for WebGL VideoTexture — else
// the canvas is tainted and the shader silently fails).
//
// Strategy: we have 7 confirmed CORS-enabled Cloudinary demo MP4s. Cloudinary
// transformation URLs let us derive *many* visually distinct pieces from the
// same source:
//   e_kaleidoscope:N  — kaleidoscope fold (N = mirror count)
//   e_boomerang       — forward→reverse loop, perfect for endless flythroughs
//   e_accelerate:-50  — half-speed slow-mo (feels 3D / dreamy)
//   e_accelerate:200  — triple-speed (pulse / chaos)
//   e_negate          — color-inverted
//   e_hue:N           — hue shift
//   e_blur:500        — heavy blur (abstract wash)
//   e_vignette:60     — dark-corner cinematic
//
// Combining these gives us ~40 distinct visuals on trusted infrastructure.

const CDN = "https://res.cloudinary.com/demo/video/upload";

// Base sources (all confirmed CORS-friendly).
const BASE = {
  dog:     `${CDN}/dog.mp4`,
  turtle:  `${CDN}/sea_turtle.mp4`,
  eleph:   `${CDN}/elephants.mp4`,
  kitten:  `${CDN}/kitten_fighting.mp4`,
  eagle:   `${CDN}/eagle.mp4`,
  cat:     `${CDN}/cat.mp4`,
  fog:     `${CDN}/fog.mp4`,
};

// Helper to build a transformed Cloudinary URL.
function tx(base, ...transforms) {
  // Cloudinary URL pattern: .../upload/<transforms>/<public_id>.mp4
  // base is full URL — we need to inject transforms between /upload/ and the id.
  const [pre, post] = base.split("/upload/");
  return `${pre}/upload/${transforms.join(",")}/${post}`;
}

// Categorized library. Each entry has id, name, emoji, uri, category.
export const LIBRARY = [
  // === 🐾 Wildlife (base) ===
  { id: "w-dog",     cat: "wildlife", name: "🐕 Dog",     uri: BASE.dog },
  { id: "w-turtle",  cat: "wildlife", name: "🐢 Sea turtle", uri: BASE.turtle },
  { id: "w-eleph",   cat: "wildlife", name: "🐘 Elephants", uri: BASE.eleph },
  { id: "w-kitten",  cat: "wildlife", name: "🐱 Kittens",  uri: BASE.kitten },
  { id: "w-eagle",   cat: "wildlife", name: "🦅 Eagle",    uri: BASE.eagle },
  { id: "w-cat",     cat: "wildlife", name: "🐈 Cat",      uri: BASE.cat },
  { id: "w-fog",     cat: "wildlife", name: "🌫️ Fog",     uri: BASE.fog },

  // === 🌀 Kaleidoscope (6/8/12-fold mirrored) — perfect for mapped surfaces ===
  { id: "k-dog-6",    cat: "kaleido", name: "🌀 Kaleido dog 6",    uri: tx(BASE.dog,   "e_kaleidoscope:6") },
  { id: "k-dog-12",   cat: "kaleido", name: "🌀 Kaleido dog 12",   uri: tx(BASE.dog,   "e_kaleidoscope:12") },
  { id: "k-turtle",   cat: "kaleido", name: "🌀 Kaleido turtle",   uri: tx(BASE.turtle,"e_kaleidoscope:8") },
  { id: "k-eleph",    cat: "kaleido", name: "🌀 Kaleido elephants",uri: tx(BASE.eleph, "e_kaleidoscope:10") },
  { id: "k-kitten",   cat: "kaleido", name: "🌀 Kaleido kittens",  uri: tx(BASE.kitten,"e_kaleidoscope:6") },
  { id: "k-eagle",    cat: "kaleido", name: "🌀 Kaleido eagle",    uri: tx(BASE.eagle, "e_kaleidoscope:8") },
  { id: "k-fog",      cat: "kaleido", name: "🌀 Kaleido fog",      uri: tx(BASE.fog,   "e_kaleidoscope:12") },
  { id: "k-fog-hue",  cat: "kaleido", name: "🌀 Kaleido psych",    uri: tx(BASE.fog,   "e_kaleidoscope:8", "e_hue:120") },

  // === ✨ 3D floating (slow, shiny — highlights pop-out + float anim) ===
  { id: "f-turtle-slow",  cat: "floating", name: "✨ Turtle drift", uri: tx(BASE.turtle, "e_accelerate:-60") },
  { id: "f-eleph-slow",   cat: "floating", name: "✨ Slow herd",    uri: tx(BASE.eleph,  "e_accelerate:-50") },
  { id: "f-eagle-slow",   cat: "floating", name: "✨ Soaring",      uri: tx(BASE.eagle,  "e_accelerate:-40") },
  { id: "f-fog-slow",     cat: "floating", name: "✨ Drifting fog", uri: tx(BASE.fog,    "e_accelerate:-60") },
  { id: "f-dog-slow",     cat: "floating", name: "✨ Dreamy dog",   uri: tx(BASE.dog,    "e_accelerate:-50", "e_vignette:60") },

  // === ♾️ Flythrough / boomerang (forward → reverse = endless loop) ===
  { id: "t-turtle-boom", cat: "flythrough", name: "♾️ Turtle loop",  uri: tx(BASE.turtle, "e_boomerang") },
  { id: "t-eleph-boom",  cat: "flythrough", name: "♾️ Elephants loop", uri: tx(BASE.eleph,  "e_boomerang") },
  { id: "t-dog-boom",    cat: "flythrough", name: "♾️ Dog loop",     uri: tx(BASE.dog,    "e_boomerang") },
  { id: "t-cat-boom",    cat: "flythrough", name: "♾️ Cat loop",     uri: tx(BASE.cat,    "e_boomerang") },
  { id: "t-eagle-boom",  cat: "flythrough", name: "♾️ Eagle loop",   uri: tx(BASE.eagle,  "e_boomerang") },
  { id: "t-fog-boom",    cat: "flythrough", name: "♾️ Fog drift",    uri: tx(BASE.fog,    "e_boomerang", "e_accelerate:-40") },

  // === 🎨 Abstract (blur / negate / hue-shift — great for mood layers) ===
  { id: "a-fog-neg",    cat: "abstract", name: "🎨 Neg fog",     uri: tx(BASE.fog,   "e_negate") },
  { id: "a-turtle-blur",cat: "abstract", name: "🎨 Blur deep",   uri: tx(BASE.turtle,"e_blur:500") },
  { id: "a-eleph-blur", cat: "abstract", name: "🎨 Blur herd",   uri: tx(BASE.eleph, "e_blur:800") },
  { id: "a-dog-hue",    cat: "abstract", name: "🎨 Pink dog",    uri: tx(BASE.dog,   "e_hue:140") },
  { id: "a-kitten-hue", cat: "abstract", name: "🎨 Green kittens",uri: tx(BASE.kitten,"e_hue:90") },
  { id: "a-eagle-neg",  cat: "abstract", name: "🎨 Neg eagle",   uri: tx(BASE.eagle, "e_negate") },
  { id: "a-cat-psy",    cat: "abstract", name: "🎨 Cat trip",    uri: tx(BASE.cat,   "e_kaleidoscope:16", "e_hue:200", "e_vignette:80") },

  // === ⚡ Chaos (fast / pulse / glitch — great for rave / glitch styles) ===
  { id: "c-dog-fast",    cat: "chaos", name: "⚡ Dog pulse",    uri: tx(BASE.dog,    "e_accelerate:200") },
  { id: "c-kitten-fast", cat: "chaos", name: "⚡ Kitten strobe",uri: tx(BASE.kitten, "e_accelerate:300") },
  { id: "c-eagle-fast",  cat: "chaos", name: "⚡ Eagle blitz",  uri: tx(BASE.eagle,  "e_accelerate:200") },
  { id: "c-eleph-fast",  cat: "chaos", name: "⚡ Stampede",     uri: tx(BASE.eleph,  "e_accelerate:250") },
  { id: "c-fog-fast",    cat: "chaos", name: "⚡ Smoke rush",   uri: tx(BASE.fog,    "e_accelerate:200", "e_negate") },
];

export const CATEGORIES = [
  { id: "all",        name: "All",         icon: "📚" },
  { id: "floating",   name: "3D Floating", icon: "✨" },
  { id: "kaleido",    name: "Kaleido",     icon: "🌀" },
  { id: "flythrough", name: "Flythrough",  icon: "♾️" },
  { id: "wildlife",   name: "Wildlife",    icon: "🐾" },
  { id: "abstract",   name: "Abstract",    icon: "🎨" },
  { id: "chaos",      name: "Chaos",       icon: "⚡" },
];

// Convenience: get all for a given category.
export function getByCategory(catId) {
  if (catId === "all") return LIBRARY;
  return LIBRARY.filter(v => v.cat === catId);
}

// Top picks to preload (served from Cloudinary CDN edge — each ~1-3 MB).
// These are the highest-wow items per category that we want warm on first
// interaction. Called by mapper.html / player.html via <link rel=preload>.
export const PRELOAD_TOP = [
  LIBRARY.find(v => v.id === "k-fog"),
  LIBRARY.find(v => v.id === "f-turtle-slow"),
  LIBRARY.find(v => v.id === "t-eleph-boom"),
  LIBRARY.find(v => v.id === "k-dog-12"),
  LIBRARY.find(v => v.id === "a-cat-psy"),
].filter(Boolean);

// Preload via hidden <link rel="preload" as="video"> — lets the browser
// warm the HTTP cache + start TCP/TLS negotiation for the CDN so the first
// click-to-assign feels instant. Use inside a <head> or call at startup.
export function injectPreloadTags(doc = document, max = 5) {
  const picks = PRELOAD_TOP.slice(0, max);
  for (const p of picks) {
    if (!p) continue;
    // Skip if already present.
    if (doc.head.querySelector(`link[rel="preload"][href="${p.uri}"]`)) continue;
    const link = doc.createElement("link");
    link.rel = "preload";
    link.as = "video";
    link.href = p.uri;
    link.crossOrigin = "anonymous";
    doc.head.appendChild(link);
  }
}

// Eagerly warm the HTTP cache for the top N by issuing a fetch() with
// keepalive. Cheaper than real preload + works from any origin. Call after
// first paint so it doesn't block LCP.
export async function warmCache(max = 8) {
  const picks = LIBRARY.slice(0, max);
  const results = await Promise.allSettled(picks.map(p =>
    fetch(p.uri, { mode: "no-cors", keepalive: true, method: "GET", cache: "force-cache" })
  ));
  return results.filter(r => r.status === "fulfilled").length;
}
