// HTML smoke test — every shipped HTML page is well-formed enough that the
// browser will reach the script tag we expect. This catches:
//   - missing <script type="module"> tags
//   - missing element ids the JS expects to find
//   - importmap regressions (three.js can't resolve)
//   - script src paths that no longer exist on disk
//
// Strict-no-deps: pure regex + fs. No JSDOM.

import { readFile, access } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { suite, ok, equal, report } from "./_assert.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const PUBLIC = join(ROOT, "public");

async function readHtml(name) {
  return await readFile(join(PUBLIC, name), "utf8");
}
async function exists(rel) {
  try { await access(join(PUBLIC, rel)); return true; }
  catch { return false; }
}

suite("html smoke");

// All three flagship pages exist + are non-trivial.
for (const page of ["index.html", "mapper.html", "player.html", "cam-diag.html"]) {
  const html = await readHtml(page);
  ok(html.length > 500, `${page} non-empty (${html.length} bytes)`);
  ok(/<title>[^<]+<\/title>/i.test(html), `${page} has <title>`);
  ok(/<meta\s+charset=/i.test(html), `${page} declares charset`);
}

// Every <script src="..."> and <link href="..."> must resolve to a real
// file under public/ (unless it's a CDN URL with http/https).
for (const page of ["index.html", "mapper.html", "player.html"]) {
  const html = await readHtml(page);
  const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:|\/\/|data:)/.test(u) && !u.startsWith("#"));
  for (const u of refs) {
    // Strip ?v=N cache-bust query strings.
    const path = u.split("?")[0];
    const exists_ = await exists(path);
    ok(exists_, `${page} → ${u} resolves on disk`);
  }
}

// Importmap sanity — every flagship page that uses ES modules should have
// a three.js import mapping (so `import * as THREE from "three"` resolves).
for (const page of ["index.html", "mapper.html", "player.html"]) {
  const html = await readHtml(page);
  const hasImportMap = /<script\s+type=["']importmap["']/i.test(html);
  const hasThreeAlias = /"three":/.test(html);
  ok(hasImportMap, `${page} has an <script type="importmap">`);
  ok(hasThreeAlias, `${page} importmap aliases "three"`);
}

// Required element ids the JS expects to find. Each page's JS will throw at
// runtime if these go missing; we catch it here.
const REQUIRED_IDS = {
  "index.html": ["pov-pill", "stereo-pill", "hdri-pill"],
  "mapper.html": ["gl", "canvas-holder", "mapper-toolbar", "surface-video-picker", "surface-list-panel"],
  "player.html": ["gl", "canvas-holder", "style-picker", "stereo-picker", "player-info"],
};
for (const [page, ids] of Object.entries(REQUIRED_IDS)) {
  const html = await readHtml(page);
  for (const id of ids) {
    const found = new RegExp(`id=["']${id}["']`).test(html);
    ok(found, `${page} contains element with id="${id}"`);
  }
}

// POV pill on Studio MUST include all 4 buttons (off / face / hand / gaze).
{
  const html = await readHtml("index.html");
  for (const pov of ["off", "face", "hand", "gaze"]) {
    ok(new RegExp(`data-pov="${pov}"`).test(html), `Studio POV pill has [data-pov="${pov}"]`);
  }
}

// Mapper toolbar MUST include the Maptastic Calibrate button.
{
  const html = await readHtml("mapper.html");
  ok(/data-act="calibrate"/.test(html), 'Mapper toolbar has [data-act="calibrate"] (🎯 Calibrate)');
}

// CSP from vercel.json should at least not be undefined in deploy config.
{
  const vercel = await readFile(join(ROOT, "vercel.json"), "utf8");
  ok(/Content-Security-Policy/.test(vercel), "vercel.json ships Content-Security-Policy header");
  ok(/frame-ancestors 'none'/.test(vercel), "vercel.json CSP locks frame-ancestors to 'none'");
  ok(/X-Frame-Options/.test(vercel), "vercel.json ships X-Frame-Options");
  ok(/Permissions-Policy/.test(vercel), "vercel.json ships Permissions-Policy");
}

report();
