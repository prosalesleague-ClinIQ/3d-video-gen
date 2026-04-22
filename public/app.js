(function () {
  const BACKEND = window.__BACKEND_URL__ || "";
  const POLL_INTERVAL_MS = 3000;
  const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

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

  els.exampleChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      els.prompt.value = chip.textContent.trim();
      els.prompt.focus();
    });
  });

  async function probeBackend() {
    setStatus("checking", "Connecting to render backend...");
    if (!BACKEND) {
      setStatus("err", "Backend not configured");
      return;
    }
    try {
      const t0 = Date.now();
      const res = await fetch(`${BACKEND}/health`);
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

  let elapsedTimer = null;
  let renderStartTs = 0;

  function showProgress(pct, stageText) {
    els.progress.classList.add("active");
    els.progressBar.style.width = Math.max(pct, 3) + "%";
    els.progressLabel.textContent = stageText || "Working...";
  }

  function startElapsed() {
    renderStartTs = Date.now();
    elapsedTimer = setInterval(() => {
      els.progressElapsed.textContent = ((Date.now() - renderStartTs) / 1000).toFixed(1) + "s";
    }, 100);
  }

  function stopElapsed() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function hideProgress() {
    els.progress.classList.remove("active");
  }

  function showError(msg) {
    els.errorBox.textContent = msg;
    els.errorBox.classList.add("visible");
  }

  function clearError() {
    els.errorBox.classList.remove("visible");
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function prettyStage(stage) {
    const map = {
      queued: "Queued...",
      building_scene: "Building scene graph...",
      scene_ready: "Scene ready, launching Blender...",
      rendering_frames: "Starting render...",
      composing_video: "Stitching video with ffmpeg...",
      complete: "Done!",
      error: "Failed",
    };
    if (map[stage]) return map[stage];
    if (stage && stage.startsWith("rendering ")) {
      return `Rendering ${stage.replace("rendering ", "")}...`;
    }
    return stage || "Working...";
  }

  async function submitJob(prompt) {
    const res = await fetch(`${BACKEND}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST /generate failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function pollStatus(renderId) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      let data;
      try {
        const res = await fetch(`${BACKEND}/status/${renderId}`);
        if (!res.ok) {
          // Skip transient error, keep polling
          continue;
        }
        data = await res.json();
      } catch (e) {
        continue;
      }

      showProgress(data.progress || 0, prettyStage(data.stage));

      if (data.status === "complete") return data;
      if (data.status === "failed") throw new Error(data.error || "Render failed on server");
    }
    throw new Error("Render timed out after 10 minutes");
  }

  async function generate(prompt) {
    clearError();
    els.videoSection.classList.remove("visible");
    els.submit.disabled = true;
    els.submit.textContent = "Rendering...";
    showProgress(3, "Submitting...");
    startElapsed();

    try {
      const queued = await submitJob(prompt);
      showProgress(5, "Queued — waking renderer...");

      const done = await pollStatus(queued.render_id);

      const videoUrl = done.video_url.startsWith("http")
        ? done.video_url
        : `${BACKEND}${done.video_url}`;

      els.video.src = videoUrl;
      els.video.load();
      els.videoMeta.textContent =
        `${done.frames} frames · ${(done.render_ms / 1000).toFixed(1)}s render`;
      els.sceneGraph.textContent = JSON.stringify(done.scene_graph, null, 2);
      els.videoSection.classList.add("visible");

      showProgress(100, "Done!");
      setTimeout(hideProgress, 800);
      setStatus("ok", `Rendered in ${(done.render_ms / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(e);
      hideProgress();
      showError(e.message || "Something went wrong. Try again in 30 seconds.");
      setStatus("err", "Render failed");
    } finally {
      stopElapsed();
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

  els.prompt.placeholder = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];

  probeBackend();
})();
