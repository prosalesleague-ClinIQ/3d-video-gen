// Shared help / keyboard-shortcuts modal. Mounted on every page; opens with
// the `?` key (or `Shift+/` which produces `?` on US keyboards) or by clicking
// the small `?` button if a page renders one.
//
// Why a module not inline: keeps the same shortcut list + same DOM in three
// places (Studio, Mapper, Player). Add a row here once and it ships everywhere.

const SHORTCUTS = {
  global: [
    ["?", "Open this help"],
    ["Esc", "Close any open modal"],
  ],
  studio: [
    ["1–8", "Switch style preset"],
    ["Space", "Play / pause"],
    ["F", "Fullscreen"],
    ["H", "Hide UI"],
  ],
  mapper: [
    ["1", "Start camera"],
    ["2", "Scan for surfaces"],
    ["D", "Detail scan"],
    ["L", "Light/Dark scan (best for paintings)"],
    ["R", "Randomise videos on empty surfaces"],
    ["M", "Toggle Maptastic 4-corner calibration"],
    ["G", "Toggle reference grid"],
    ["Space", "Play / pause all videos"],
    ["Del", "Delete selected surface"],
    ["F", "Fullscreen"],
    ["Esc", "Cancel draw / close picker"],
  ],
  player: [
    ["1–8", "Switch style preset"],
    ["Space", "Play / pause"],
    ["F", "Fullscreen"],
    ["H", "Hide UI"],
  ],
};

const FLOW = {
  studio: [
    "Pick a HDRI background + style preset.",
    "Optionally enable POV tracking (Face / Hand / Gaze) for parallax.",
    "Drop a prompt or photo into the input row to generate a 3D scene.",
  ],
  mapper: [
    "Click 🎥 Camera and allow webcam.",
    "Point at a wall or framed art and 🤖 Scan.",
    "Click each detected rectangle to assign a video.",
    "Save the project — you'll get a share link for the Player.",
  ],
  player: [
    "Paste a project ID or use a ?id=… URL.",
    "Pick a style preset (vaporwave, gallery, cinema…).",
    "For an Epson 3D projector: click 🎥 Epson 3D preset, then Side-by-Side on the remote.",
  ],
};

function detectPage() {
  if (document.body.classList.contains("app-mapper")) return "mapper";
  if (document.body.classList.contains("app-player")) return "player";
  return "studio";
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function buildModal() {
  if (document.getElementById("help-modal")) return;
  const page = detectPage();
  const pageRows = SHORTCUTS[page] || [];
  const flow = FLOW[page] || [];

  const rowsHtml = (rows) => rows.map(([k, desc]) =>
    `<tr><td class="hm-key"><kbd>${escHtml(k)}</kbd></td><td>${escHtml(desc)}</td></tr>`
  ).join("");
  const flowHtml = flow.map((s, i) =>
    `<li><span class="hm-num">${i + 1}</span> ${escHtml(s)}</li>`
  ).join("");

  const modal = document.createElement("div");
  modal.id = "help-modal";
  modal.className = "help-modal hidden";
  modal.innerHTML = `
    <div class="help-modal-card" role="dialog" aria-label="Help and keyboard shortcuts">
      <button class="help-modal-close" id="help-modal-close" aria-label="Close">✕</button>
      <h2>Help · ${escHtml(page === "mapper" ? "Mapper" : page === "player" ? "Player" : "Studio")}</h2>
      <h3>Quick flow</h3>
      <ol class="help-flow">${flowHtml}</ol>
      <h3>Keyboard shortcuts</h3>
      <table class="help-keys">
        <tbody>
          ${rowsHtml(pageRows)}
          ${rowsHtml(SHORTCUTS.global)}
        </tbody>
      </table>
      <p class="help-foot">
        Full guide: <a href="/USER_GUIDE.md" target="_blank" rel="noopener noreferrer">USER_GUIDE.md</a>
      </p>
    </div>
  `;
  document.body.appendChild(modal);

  // Close handlers — click backdrop, click ✕, press Esc.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeHelp();
  });
  document.getElementById("help-modal-close")?.addEventListener("click", closeHelp);
}

function openHelp() {
  buildModal();
  document.getElementById("help-modal")?.classList.remove("hidden");
}

function closeHelp() {
  document.getElementById("help-modal")?.classList.add("hidden");
}

// Global key binding — `?` opens, `Esc` closes. Skip when typing in inputs.
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea") || e.target.isContentEditable) return;
  if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
    e.preventDefault();
    const open = document.getElementById("help-modal")?.classList.contains("hidden") === false;
    if (open) closeHelp(); else openHelp();
  } else if (e.key === "Escape") {
    closeHelp();
  }
});

// Mount a small ? button in any container with id="help-mount". Optional —
// pages can choose to surface a button or just rely on the keyboard.
document.addEventListener("DOMContentLoaded", () => {
  const mount = document.getElementById("help-mount");
  if (mount && !mount.dataset.wired) {
    const btn = document.createElement("button");
    btn.className = "help-btn";
    btn.type = "button";
    btn.title = "Help (?)";
    btn.textContent = "?";
    btn.addEventListener("click", openHelp);
    mount.appendChild(btn);
    mount.dataset.wired = "1";
  }
});

export { openHelp, closeHelp };
