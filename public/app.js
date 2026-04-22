(function () {
  const BACKEND = window.__BACKEND_URL__ || "";

  const els = {
    prompt: document.getElementById("prompt"),
    submit: document.getElementById("submit"),
    progress: document.getElementById("progress"),
    progressLabel: document.getElementById("progress-label"),
    progressElapsed: document.getElementById("progress-elapsed"),
    progressBar: document.getElementById("progress-bar"),
    videoSection: document.getElementById("video-section"),
    video: document.getElementById("video"),
    videoMeta: document.getElementById("video-meta"),
    sceneGraph: document.getElementById("scene-graph"),
    errorBox: document.getElementById("error-box"),
    statusPill: document.getElementById("status-pill"),
    exampleChips: document.querySelectorAll(".example-chip"),
  };

  const EXAMPLES = [
    "a cinematic golden cube spinning in light",
    "a purple sphere orbiting a blue planet",
    "a chrome torus rotating against dark cosmos",
    "a red pyramid glowing in a spotlight",
    "a shiny silver monkey head under warm light",
    "a green cylinder tumbling through space",
  ];

  // Wire example chips
  els.exampleChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      els.prompt.value = chip.textContent.trim();
      els.prompt.focus();
    });
  });

  // Check backend status on load
  async function probeBackend() {
    setStatus("checking", "Connecting to render backend...");
    if (!BACKEND) {
      setStatus("err", "Backend not configured");
      return;
    }
    try {
      const t0 = Date.now();
      const res = await fetch(`${BACKEND}/health`, { method: "GET" });
      const latency = Date.now() - t0;
      if (res.ok) {
        setStatus("ok", `Backend ready · ${latency}ms`);
      } else {
        setStatus("warm", `Backend waking up (HTTP ${res.status})...`);
      }
    } catch (e) {
      setStatus("warm", "Backend cold-starting (first request may take longer)");
    }
  }

  function setStatus(kind, text) {
    els.statusPill.className = "status-pill " + (kind === "err" ? "err" : kind === "warm" ? "warm" : "");
    els.statusPill.querySelector(".label").textContent = text;
  }

  // Progress animation during render
  let progressTimer = null;
  let renderStartTs = 0;

  function startProgress() {
    els.progress.classList.add("active");
    els.progressBar.style.width = "5%";
    renderStartTs = Date.now();

    const steps = [
      { at: 2000,  pct: 15, text: "Generating scene graph..." },
      { at: 6000,  pct: 30, text: "Launching Blender..." },
      { at: 12000, pct: 45, text: "Rendering frames..." },
      { at: 30000, pct: 65, text: "Rendering frames (CPU takes ~1–2 min)..." },
      { at: 60000, pct: 80, text: "Almost there — stitching video..." },
      { at: 90000, pct: 90, text: "Finalizing MP4..." },
    ];

    progressTimer = setInterval(() => {
      const elapsed = Date.now() - renderStartTs;
      els.progressElapsed.textContent = (elapsed / 1000).toFixed(1) + "s";
      for (const s of steps) {
        if (elapsed > s.at) {
          els.progressBar.style.width = s.pct + "%";
          els.progressLabel.textContent = s.text;
        }
      }
    }, 250);
  }

  function stopProgress(success) {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    if (success) {
      els.progressBar.style.width = "100%";
      els.progressLabel.textContent = "Done!";
      setTimeout(() => els.progress.classList.remove("active"), 800);
    } else {
      els.progress.classList.remove("active");
    }
  }

  function showError(msg) {
    els.errorBox.textContent = msg;
    els.errorBox.classList.add("visible");
  }

  function clearError() {
    els.errorBox.classList.remove("visible");
  }

  async function generate(prompt) {
    clearError();
    els.videoSection.classList.remove("visible");
    els.submit.disabled = true;
    els.submit.textContent = "Rendering...";
    startProgress();

    try {
      const res = await fetch(`${BACKEND}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        let detail = "";
        try {
          const err = await res.json();
          detail = err.detail || err.error || JSON.stringify(err);
        } catch {
          detail = await res.text();
        }
        throw new Error(`Server error ${res.status}: ${detail.slice(0, 200)}`);
      }

      const data = await res.json();

      const videoUrl = data.video_url.startsWith("http")
        ? data.video_url
        : `${BACKEND}${data.video_url}`;

      els.video.src = videoUrl;
      els.video.load();
      els.videoMeta.textContent =
        `${data.frames} frames · ${(data.render_ms / 1000).toFixed(1)}s render`;
      els.sceneGraph.textContent = JSON.stringify(data.scene_graph, null, 2);
      els.videoSection.classList.add("visible");

      stopProgress(true);
      setStatus("ok", `Rendered in ${(data.render_ms / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(e);
      stopProgress(false);
      showError(e.message || "Something went wrong. The backend may be cold-starting — try again in 30 seconds.");
      setStatus("err", "Render failed");
    } finally {
      els.submit.disabled = false;
      els.submit.textContent = "Generate Video";
    }
  }

  els.submit.addEventListener("click", () => {
    const prompt = els.prompt.value.trim();
    if (!prompt) {
      showError("Please enter a prompt.");
      return;
    }
    generate(prompt);
  });

  els.prompt.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      els.submit.click();
    }
  });

  // Seed random example
  els.prompt.placeholder = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];

  probeBackend();
})();
