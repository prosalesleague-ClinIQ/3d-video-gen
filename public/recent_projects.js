// recent_projects.js — local history of saved/loaded projects.
//
// localStorage["recent-projects"] = JSON.stringify([
//   { id: "uuid", name: "...", ts: epoch_ms, source: "saved" | "loaded" }, ...
// ])
//
// Cap at MAX entries (newest first, LRU eviction). Survives across sessions
// + across all three pages on the same origin (Studio / Mapper / Player).
//
// Used by:
//   - save_modal.js — pushes onto the list every time saveToBackend succeeds
//   - mapper.js / app.js — pushes when a project is successfully loaded
//   - player.html empty-state — renders the list as quick-launch cards

const KEY = "recent-projects";
const MAX = 30;

// SECURITY: id + name come from a Backend response. We escape them at the
// point of HTML render (player.js / save_modal.js); recent_projects.js
// itself only stores + returns strings.

function _read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e.id === "string");
  } catch { return []; }
}

function _write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
}

// Push a project. If `id` already exists, update its name + ts (so reloading
// an old project bubbles it back to the top of the list).
export function addProject({ id, name = "untitled", source = "saved" }) {
  if (!id || typeof id !== "string") return;
  const list = _read();
  const existingIdx = list.findIndex((e) => e.id === id);
  const entry = { id, name: String(name).slice(0, 120), ts: Date.now(), source };
  if (existingIdx >= 0) list.splice(existingIdx, 1);
  list.unshift(entry);
  _write(list);
}

export function removeProject(id) {
  _write(_read().filter((e) => e.id !== id));
}

export function clearAll() {
  try { localStorage.removeItem(KEY); } catch {}
}

export function listProjects({ limit = MAX } = {}) {
  return _read().slice(0, limit);
}

// Time-ago helper for the gallery UI. Returns short strings like "3m", "2h".
export function timeAgo(ts) {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// Subscribe to cross-tab changes (Mapper saves a project → Player updates
// its recent list live). Returns an unsubscribe function.
export function onChange(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = (e) => { if (e.key === KEY) callback(_read()); };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
