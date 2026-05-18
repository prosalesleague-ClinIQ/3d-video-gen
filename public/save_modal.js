// save_modal.js — single shared save dialog that replaces browser prompt().
//
// Why centralised: Mapper and Studio both saved via window.prompt(), which:
//   - can't be styled
//   - blocks the page on focus loss in some browsers
//   - doesn't fit on small screens / inside Vercel previews behind auth
//   - is hostile to non-technical users
//
// API:
//   import { openSaveModal } from "./save_modal.js";
//   const result = await openSaveModal({
//     suggestedName: "untitled",
//     saver: async (name) => projectionHandle.saveToBackend(name, BACKEND),
//   });
//   // result = { ok: true, id, name } or { ok: false, error } or null on cancel
//
// On success the modal stays open and shows the project ID + Player share
// URL + Copy + Open-in-Player buttons. User dismisses with Esc or the close
// button. Also pushes the project into recent_projects.js automatically.

import { addProject } from "./recent_projects.js";

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function buildModal() {
  let modal = document.getElementById("save-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "save-modal";
  modal.className = "save-modal hidden";
  modal.innerHTML = `
    <div class="save-modal-card" role="dialog" aria-label="Save project">
      <button class="save-modal-close" id="save-modal-close" aria-label="Close">✕</button>
      <h2 id="save-modal-title">Save project</h2>
      <div class="save-modal-body" id="save-modal-body"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeSaveModal(); });
  document.getElementById("save-modal-close")?.addEventListener("click", closeSaveModal);
  return modal;
}

let _outerResolver = null;
function closeSaveModal(value = null) {
  document.getElementById("save-modal")?.classList.add("hidden");
  if (_outerResolver) { _outerResolver(value); _outerResolver = null; }
}

function renderNameForm({ modal, suggestedName, onSubmit, onCancel }) {
  const body = modal.querySelector("#save-modal-body");
  document.getElementById("save-modal-title").textContent = "Save project";
  body.innerHTML = `
    <p class="save-modal-prompt">Give your projection mapping a name so you can find it later.</p>
    <input type="text" id="save-modal-name" class="save-modal-input"
      placeholder="e.g. 'living-room-wall', 'gallery-show-001'"
      maxlength="120"
      value="${escHtml(suggestedName)}" />
    <div class="save-modal-actions">
      <button class="primary" id="save-modal-submit">💾 Save</button>
      <button class="secondary" id="save-modal-cancel">Cancel</button>
    </div>
  `;
  const input = body.querySelector("#save-modal-name");
  setTimeout(() => { input.focus(); input.select(); }, 50);
  body.querySelector("#save-modal-cancel").addEventListener("click", () => onCancel());
  body.querySelector("#save-modal-submit").addEventListener("click", () => onSubmit(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onSubmit(input.value); }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  });
}

function renderResult({ modal, id, name }) {
  const body = modal.querySelector("#save-modal-body");
  const playerUrl = `${location.origin}/player.html?id=${encodeURIComponent(id)}`;
  document.getElementById("save-modal-title").textContent = "Saved ✓";
  body.innerHTML = `
    <p class="save-modal-prompt">Your project is live at:</p>
    <div class="save-modal-row">
      <input type="text" id="save-modal-url" class="save-modal-input" readonly value="${escHtml(playerUrl)}" />
      <button class="secondary" id="save-modal-copy" title="Copy to clipboard">📋 Copy</button>
    </div>
    <div class="save-modal-meta">
      <span class="save-modal-id-label">Project ID</span>
      <code class="save-modal-id">${escHtml(id)}</code>
    </div>
    <div class="save-modal-actions">
      <a class="primary" id="save-modal-open" target="_blank" rel="noopener" href="${escHtml(playerUrl)}">🎬 Open in Player</a>
      <button class="secondary" id="save-modal-done">Done</button>
    </div>
  `;
  body.querySelector("#save-modal-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(playerUrl);
      const b = body.querySelector("#save-modal-copy");
      const orig = b.textContent;
      b.textContent = "✓ Copied";
      setTimeout(() => { b.textContent = orig; }, 1400);
    } catch {
      // Fallback: select the input + execCommand copy. Some browsers in
      // iframes refuse the navigator.clipboard write.
      body.querySelector("#save-modal-url").select();
      try { document.execCommand("copy"); } catch {}
    }
  });
  body.querySelector("#save-modal-done").addEventListener("click", () => closeSaveModal({ ok: true, id, name }));
}

function renderError({ modal, errorMsg, onRetry }) {
  const body = modal.querySelector("#save-modal-body");
  document.getElementById("save-modal-title").textContent = "Save failed";
  body.innerHTML = `
    <p class="save-modal-error">${escHtml(errorMsg)}</p>
    <div class="save-modal-actions">
      <button class="primary" id="save-modal-retry">↺ Try again</button>
      <button class="secondary" id="save-modal-close-err">Close</button>
    </div>
  `;
  body.querySelector("#save-modal-retry").addEventListener("click", onRetry);
  body.querySelector("#save-modal-close-err").addEventListener("click", () => closeSaveModal({ ok: false, error: errorMsg }));
}

/**
 * Open the save modal. Returns a Promise that resolves with:
 *   { ok: true, id, name }   — user successfully saved
 *   { ok: false, error }     — save failed and user closed
 *   null                     — user cancelled before saving
 */
export function openSaveModal({ suggestedName = "untitled", saver }) {
  if (typeof saver !== "function") {
    return Promise.resolve({ ok: false, error: "no_saver_function_provided" });
  }
  return new Promise((resolve) => {
    _outerResolver = resolve;
    const modal = buildModal();
    modal.classList.remove("hidden");

    const submit = async (rawName) => {
      const name = String(rawName ?? "").trim().slice(0, 120) || "untitled";
      // Show inline saving state.
      document.getElementById("save-modal-title").textContent = "Saving…";
      modal.querySelector("#save-modal-body").innerHTML = `<p class="save-modal-prompt save-modal-spinner">Uploading to backend…</p>`;
      try {
        const res = await saver(name);
        const id = res?.project_id || res?.id;
        if (!id) throw new Error("backend returned no project_id");
        addProject({ id, name, source: "saved" });
        renderResult({ modal, id, name });
      } catch (e) {
        const errorMsg = e?.message || String(e);
        renderError({ modal, errorMsg, onRetry: () => renderNameForm({ modal, suggestedName, onSubmit: submit, onCancel: () => closeSaveModal(null) }) });
      }
    };

    renderNameForm({
      modal,
      suggestedName,
      onSubmit: submit,
      onCancel: () => closeSaveModal(null),
    });
  });
}

// Esc key always closes (handled here so we don't fight with help_modal.js's
// Esc handler — both modals respect Esc).
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const open = document.getElementById("save-modal")?.classList.contains("hidden") === false;
    if (open) closeSaveModal(null);
  }
});

export { closeSaveModal };
