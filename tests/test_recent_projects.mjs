// recent_projects.js — localStorage-backed save/load history.
//
// Same DOM-shim pattern as test_calibration.mjs.

import { suite, ok, equal, report } from "./_assert.mjs";

// --- minimal localStorage shim --------------------------------------------
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};

const _listeners = [];
globalThis.window = {
  addEventListener: (type, fn) => _listeners.push({ type, fn }),
  removeEventListener: (type, fn) => {
    const i = _listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) _listeners.splice(i, 1);
  },
};
function dispatchStorage(key) {
  for (const l of _listeners) if (l.type === "storage") l.fn({ key });
}

const rp = await import("../public/recent_projects.js");

suite("recent_projects");

// --- empty state ----------------------------------------------------------
{
  equal(rp.listProjects(), [], "empty store returns empty array");
}

// --- add + list -----------------------------------------------------------
{
  rp.addProject({ id: "uuid-1", name: "wall-1", source: "saved" });
  const list = rp.listProjects();
  equal(list.length, 1, "first add → 1 entry");
  equal(list[0].id, "uuid-1", "entry.id matches");
  equal(list[0].name, "wall-1", "entry.name matches");
  equal(list[0].source, "saved", "entry.source matches");
  ok(typeof list[0].ts === "number" && list[0].ts > 0, "entry.ts is a positive number");
}

// --- newest first ---------------------------------------------------------
{
  rp.addProject({ id: "uuid-2", name: "wall-2", source: "saved" });
  rp.addProject({ id: "uuid-3", name: "wall-3", source: "loaded" });
  const list = rp.listProjects();
  equal(list[0].id, "uuid-3", "newest entry is first");
  equal(list[2].id, "uuid-1", "oldest entry is last");
}

// --- re-adding the same id bubbles it back to top ------------------------
{
  rp.addProject({ id: "uuid-1", name: "wall-1-renamed", source: "loaded" });
  const list = rp.listProjects();
  equal(list[0].id, "uuid-1", "re-added id is first");
  equal(list[0].name, "wall-1-renamed", "name updated on re-add");
  equal(list[0].source, "loaded", "source updated on re-add");
  equal(list.length, 3, "no duplicate entry created");
}

// --- removeProject --------------------------------------------------------
{
  rp.removeProject("uuid-2");
  const ids = rp.listProjects().map((e) => e.id);
  equal(ids.includes("uuid-2"), false, "removed id is gone");
  equal(ids.length, 2, "list shrinks by 1");
}

// --- timeAgo --------------------------------------------------------------
{
  equal(rp.timeAgo(Date.now()), "0s", "now → 0s");
  equal(rp.timeAgo(Date.now() - 90 * 1000), "1m", "90s ago → 1m");
  equal(rp.timeAgo(Date.now() - 7200 * 1000), "2h", "7200s ago → 2h");
}

// --- bad input is rejected ------------------------------------------------
{
  const before = rp.listProjects().length;
  rp.addProject({});                            // no id
  rp.addProject({ id: null });
  rp.addProject({ id: 123 });                   // non-string
  equal(rp.listProjects().length, before, "bad addProject calls are no-ops");
}

// --- name length cap ------------------------------------------------------
{
  const huge = "x".repeat(500);
  rp.addProject({ id: "uuid-huge", name: huge });
  const e = rp.listProjects().find((x) => x.id === "uuid-huge");
  ok(e.name.length <= 120, `name capped at 120 chars (got ${e.name.length})`);
}

// --- cap at MAX (default 30) ---------------------------------------------
{
  rp.clearAll();
  for (let i = 0; i < 50; i++) rp.addProject({ id: `uuid-${i}`, name: `n-${i}` });
  const list = rp.listProjects();
  ok(list.length <= 30, `list capped at MAX (got ${list.length})`);
  equal(list[0].id, "uuid-49", "newest is first after capping");
}

// --- onChange fires for the right key only --------------------------------
{
  let calls = 0;
  const unsub = rp.onChange(() => { calls++; });
  dispatchStorage("recent-projects");
  equal(calls, 1, "onChange fires for our key");
  dispatchStorage("some-other-key");
  equal(calls, 1, "onChange ignores other keys");
  unsub();
  dispatchStorage("recent-projects");
  equal(calls, 1, "onChange unsubscribes cleanly");
}

report();
