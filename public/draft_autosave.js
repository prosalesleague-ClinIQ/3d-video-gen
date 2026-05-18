// draft_autosave.js — keep a copy of the in-flight Mapper project in
// localStorage so a refresh, browser crash, or tab close doesn't lose work.
//
// Saves snapshot every INTERVAL ms (default 4s) AND on the `beforeunload`
// event. On next Mapper load, if a draft is present + not empty + younger
// than MAX_AGE, surface a non-blocking restore toast.

const KEY = "mapper-draft";
const INTERVAL = 4000;          // ms between snapshots
const MAX_AGE = 7 * 24 * 3600 * 1000;   // 7 days
let _timer = null;
let _snapshotFn = null;

function _read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function _write(snapshot) {
  try {
    const wrapper = { ts: Date.now(), data: snapshot };
    localStorage.setItem(KEY, JSON.stringify(wrapper));
  } catch { /* localStorage full → silently skip */ }
}

/**
 * Start the autosave loop. `snapshotFn` is called on each tick and must
 * return a plain JSON-serialisable object representing the current draft
 * (typically `projectionHandle.getSurfaces()`).
 */
export function startAutosave(snapshotFn, { interval = INTERVAL } = {}) {
  stopAutosave();
  _snapshotFn = snapshotFn;
  _timer = setInterval(_tick, interval);
  window.addEventListener("beforeunload", _tick);
}

export function stopAutosave() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  window.removeEventListener("beforeunload", _tick);
}

function _tick() {
  if (!_snapshotFn) return;
  try {
    const snapshot = _snapshotFn();
    if (!snapshot || (Array.isArray(snapshot) && snapshot.length === 0)) return;
    _write(snapshot);
  } catch { /* swallow */ }
}

/** Read the most recent draft. Returns null if absent or stale. */
export function getDraft() {
  const w = _read();
  if (!w || !w.data) return null;
  if (typeof w.ts !== "number" || Date.now() - w.ts > MAX_AGE) {
    clearDraft();
    return null;
  }
  return { ...w, ageMs: Date.now() - w.ts };
}

export function clearDraft() {
  try { localStorage.removeItem(KEY); } catch {}
}

/**
 * If a draft exists, show a non-blocking toast with Restore / Discard.
 * Resolves with the restored draft data (caller plumbs into projection
 * handle) or null if the user discarded / dismissed.
 */
export function maybeOfferRestore() {
  return new Promise((resolve) => {
    const draft = getDraft();
    if (!draft) return resolve(null);
    const items = Array.isArray(draft.data) ? draft.data.length : 0;
    if (items === 0) { clearDraft(); return resolve(null); }

    const toast = document.createElement("div");
    toast.id = "draft-restore-toast";
    toast.className = "draft-restore-toast";
    toast.innerHTML = `
      <div class="drt-msg">
        ↩ Unsaved draft from <strong>${_fmtAge(draft.ageMs)}</strong> ago — ${items} surface${items === 1 ? "" : "s"}.
      </div>
      <button class="primary" id="drt-restore">Restore</button>
      <button class="secondary" id="drt-discard">Discard</button>
    `;
    document.body.appendChild(toast);

    const finish = (val) => {
      toast.remove();
      resolve(val);
    };
    document.getElementById("drt-restore").addEventListener("click", () => finish(draft.data));
    document.getElementById("drt-discard").addEventListener("click", () => { clearDraft(); finish(null); });
    // Auto-dismiss after 15s (treat as discard but don't wipe the draft).
    setTimeout(() => { if (document.body.contains(toast)) finish(null); }, 15000);
  });
}

function _fmtAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
