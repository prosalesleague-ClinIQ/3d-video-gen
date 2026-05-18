// Dashboard 3D — global parallax + per-panel hover tilt. Aggressively
// throttled because heavy CSS custom-property writes on :root were triggering
// document-wide style recalcs every frame, freezing the page on integrated GPUs.
//
// Two layers of tilt:
//   1. GLOBAL — `--mx` / `--my` on :root, set from cursor position over the
//      whole window. Drives the parallax that separates nav / sidebar /
//      modal / overlays into different Z planes.
//   2. PER-PANEL — `--px` / `--py` on each panel element when the cursor is
//      hovering it. Drives the "physical glass slab" tilt that makes the
//      hovered panel rotate toward the cursor independently of the global
//      parallax.
//
// Both layers respect `prefers-reduced-motion`.

(function () {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  const root = document.documentElement;

  // ===== GLOBAL eased parallax (THROTTLED to ~30fps) =====
  let tx = 0, ty = 0;       // target
  let cx = 0, cy = 0;       // current (eased)
  let running = false;
  let lastTickT = 0;

  function onWindowMove(e) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    // Coalesce — only update target; the rAF tick reads the latest values.
    tx = (e.clientX / w) * 2 - 1;
    ty = (e.clientY / h) * 2 - 1;
    if (!running) { running = true; requestAnimationFrame(globalTick); }
  }
  function globalTick(t) {
    // Throttle to ~30fps. Setting CSS custom properties on :root forces a
    // document-wide style invalidation; doing it 60x/s on top of heavy
    // backdrop-filter freezes integrated-GPU machines.
    if (t - lastTickT < 32) {
      requestAnimationFrame(globalTick);
      return;
    }
    lastTickT = t;
    cx += (tx - cx) * 0.18;
    cy += (ty - cy) * 0.18;
    root.style.setProperty("--mx", cx.toFixed(3));
    root.style.setProperty("--my", cy.toFixed(3));
    if (Math.abs(tx - cx) > 0.005 || Math.abs(ty - cy) > 0.005) {
      requestAnimationFrame(globalTick);
    } else {
      running = false;
    }
  }
  window.addEventListener("pointermove", onWindowMove, { passive: true });
  window.addEventListener("pointerleave", () => {
    tx = 0; ty = 0;
    if (!running) { running = true; requestAnimationFrame(globalTick); }
  });
  // NOTE: idle breathing animation removed — it was running its own rAF loop
  // alongside globalTick which doubled the per-frame style invalidation cost
  // and contributed to page freezes.

  // ===== PER-PANEL hover tilt =====
  // SCOPED: only small interactive cards get per-element hover tilt. Big
  // chrome panels (nav/sidebar/stepper/modal) get the global parallax via
  // --mx/--my which is plenty — adding per-element tilt on top of those
  // doubled the style-recalc cost and helped freeze the page.
  const TILT_SELECTOR = [
    "[data-tilt]",
    ".style-chip",
    ".preset-chip",
    ".stereo-chip",
    ".surface-list-item",
  ].join(",");

  // Map of element → {tx, ty, cx, cy, raf} for per-panel easing.
  const panelState = new WeakMap();

  function updatePanel(el) {
    const s = panelState.get(el);
    if (!s) return;
    s.cx += (s.tx - s.cx) * 0.20;
    s.cy += (s.ty - s.cy) * 0.20;
    el.style.setProperty("--px", s.cx.toFixed(3));
    el.style.setProperty("--py", s.cy.toFixed(3));
    if (Math.abs(s.tx - s.cx) > 0.003 || Math.abs(s.ty - s.cy) > 0.003) {
      s.raf = requestAnimationFrame(() => updatePanel(el));
    } else {
      s.raf = 0;
      // If we eased back to (0,0) and target is (0,0), clear inline vars.
      if (Math.abs(s.tx) < 0.01 && Math.abs(s.ty) < 0.01) {
        el.style.removeProperty("--px");
        el.style.removeProperty("--py");
      }
    }
  }

  function onPanelMove(e) {
    const el = e.currentTarget;
    let s = panelState.get(el);
    if (!s) {
      s = { tx: 0, ty: 0, cx: 0, cy: 0, raf: 0 };
      panelState.set(el, s);
    }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    s.tx = ((e.clientX - r.left) / r.width)  * 2 - 1;   // -1..+1 across element
    s.ty = ((e.clientY - r.top)  / r.height) * 2 - 1;
    if (!s.raf) s.raf = requestAnimationFrame(() => updatePanel(el));
  }
  function onPanelLeave(e) {
    const el = e.currentTarget;
    const s = panelState.get(el);
    if (!s) return;
    s.tx = 0; s.ty = 0;
    if (!s.raf) s.raf = requestAnimationFrame(() => updatePanel(el));
  }

  function attachTo(el) {
    if (el.dataset.__tiltAttached) return;
    el.dataset.__tiltAttached = "1";
    el.addEventListener("pointermove", onPanelMove, { passive: true });
    el.addEventListener("pointerleave", onPanelLeave, { passive: true });
  }

  function attachAll() {
    document.querySelectorAll(TILT_SELECTOR).forEach(attachTo);
  }
  attachAll();

  // Watch ONLY containers that re-render dynamic chips, not the entire body.
  // Watching subtree:true on document.body fired on every video frame update
  // (VideoTexture mutations etc.) which compounded freeze symptoms.
  const watchTargets = [
    document.getElementById("style-picker"),
    document.getElementById("stereo-picker"),
    document.getElementById("surface-list"),
    document.getElementById("spv-presets"),
  ].filter(Boolean);
  if (watchTargets.length) {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes?.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches?.(TILT_SELECTOR)) attachTo(n);
          n.querySelectorAll?.(TILT_SELECTOR).forEach(attachTo);
        });
      }
    });
    watchTargets.forEach((t) => mo.observe(t, { childList: true, subtree: false }));
  }
})();
