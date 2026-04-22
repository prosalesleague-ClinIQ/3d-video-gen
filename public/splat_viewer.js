// Gaussian Splatting viewer — mounts @mkkellogg/gaussian-splats-3d into the
// existing Three.js scene in custom-render-loop mode so the host composer
// stays authoritative.

const SPLAT_MODULE = "https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js";

export const SAMPLE_SPLATS = {
  garden: "https://huggingface.co/mkkellogg/splat-data/resolve/main/garden.ksplat",
  room:   "https://huggingface.co/mkkellogg/splat-data/resolve/main/stump.ksplat",
};

export async function mountSplatViewer({ scene, camera, renderer, controls, url }) {
  let GaussianSplats3D;
  try {
    GaussianSplats3D = await import(SPLAT_MODULE);
  } catch (e) {
    throw new Error("splat_module_load_failed: " + e.message);
  }
  const viewer = new GaussianSplats3D.Viewer({
    selfDrivenMode: false,
    useBuiltInControls: false,
    threeScene: scene,
    camera,
    renderer,
    sharedMemoryForWorkers: false,
    dynamicScene: false,
  });
  await viewer.addSplatScene(url, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    showLoadingUI: true,
  });
  return {
    viewer,
    tick() {
      try { viewer.update(); viewer.render(); } catch (_) {}
    },
    dispose() {
      try {
        viewer.removeSplatScene(0);
        viewer.dispose?.();
      } catch (_) {}
    },
  };
}
