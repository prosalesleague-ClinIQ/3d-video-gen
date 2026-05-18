// video_library.js — categorized library + label resolver.

import { LIBRARY, CATEGORIES, getByCategory, getVideoLabel } from "../public/video_library.js";
import { suite, ok, equal, report } from "./_assert.mjs";

suite("video_library");

// --- structural sanity ----------------------------------------------------
ok(Array.isArray(LIBRARY) && LIBRARY.length > 20, `LIBRARY has >20 entries (got ${LIBRARY.length})`);
ok(Array.isArray(CATEGORIES) && CATEGORIES.length >= 6, `CATEGORIES has >=6 entries (got ${CATEGORIES.length})`);

// Every entry has the expected shape.
for (const v of LIBRARY) {
  ok(typeof v.id === "string" && v.id.length > 0, `library entry has string id (${v.id})`);
  ok(typeof v.uri === "string" && v.uri.startsWith("http"), `library entry has http uri`);
  ok(typeof v.name === "string" && v.name.length > 0, `library entry has name`);
  ok(typeof v.cat === "string" && v.cat.length > 0, `library entry has category`);
}

// Every entry's category is declared in CATEGORIES (except "all" which is virtual).
const declaredCats = new Set(CATEGORIES.map((c) => c.id));
for (const v of LIBRARY) {
  ok(declaredCats.has(v.cat) || v.cat === "all", `entry cat=${v.cat} is declared in CATEGORIES`);
}

// --- getByCategory --------------------------------------------------------
{
  const all = getByCategory("all");
  equal(all.length, LIBRARY.length, "getByCategory('all') returns the full library");
  const kaleido = getByCategory("kaleido");
  ok(kaleido.length > 0, "getByCategory('kaleido') is non-empty");
  ok(kaleido.every((v) => v.cat === "kaleido"), "every entry in kaleido has cat='kaleido'");
}

// --- getVideoLabel — exact match path ------------------------------------
{
  const sample = LIBRARY[0];
  equal(getVideoLabel(sample.uri), sample.name, "exact uri → library name");
}

// --- getVideoLabel — Cloudinary derivation -------------------------------
{
  const label = getVideoLabel("https://res.cloudinary.com/demo/video/upload/e_kaleidoscope:6/horse.mp4");
  ok(label.includes("horse"), `Cloudinary URL stem detected (got "${label}")`);
  ok(label.startsWith("🎬"), "Cloudinary fallback prefixes 🎬");
}

// --- getVideoLabel — edge cases ------------------------------------------
equal(getVideoLabel(null), "(empty)", "null → '(empty)'");
equal(getVideoLabel(undefined), "(empty)", "undefined → '(empty)'");
equal(getVideoLabel(""), "(empty)", "'' → '(empty)'");
equal(getVideoLabel("blob:http://x/abc"), "📦 Uploaded file", "blob: → 'Uploaded file'");
ok(getVideoLabel(123).startsWith("(") || typeof getVideoLabel(123) === "string", "non-string input doesn't throw");

// Long-URL fallback truncates from the right.
{
  const long = "https://example.com/" + "a".repeat(200);
  const label = getVideoLabel(long);
  ok(label.length <= 30, `long URL truncated (got ${label.length} chars)`);
  ok(label.includes("aaa"), "preserves rightmost characters");
}

report();
