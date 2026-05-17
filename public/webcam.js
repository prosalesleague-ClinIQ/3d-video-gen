// Shared webcam stream — single getUserMedia call, fanout to many consumers.
//
// Before this module each tracker (HeadTracker / HandTracker / ProjectionMode)
// called navigator.mediaDevices.getUserMedia independently. On a single-camera
// machine that meant only one tracker could grab the device at a time — and
// the user got 2-3 permission prompts in sequence.
//
// Now: one shared <video> element + one stream. Consumers ask for it by name
// (refcount). When the last consumer releases, we stop the stream.

let _video = null;
let _stream = null;
let _initPromise = null;
const _consumers = new Set();

const DEFAULT_CONSTRAINTS = {
  video: { width: 640, height: 480, facingMode: "user" },
  audio: false,
};

export async function getSharedWebcam(consumerName, constraints) {
  if (!consumerName) throw new Error("getSharedWebcam: consumerName required");
  _consumers.add(consumerName);

  if (_video && _stream) return { video: _video, stream: _stream };

  if (_initPromise) {
    await _initPromise;
    return { video: _video, stream: _stream };
  }

  _initPromise = (async () => {
    _stream = await navigator.mediaDevices.getUserMedia(constraints || DEFAULT_CONSTRAINTS);
    _video = document.createElement("video");
    Object.assign(_video.style, {
      position: "fixed",
      left: "-9999px",
      width: "1px",
      height: "1px",
    });
    _video.muted = true;
    _video.playsInline = true;
    _video.autoplay = true;
    _video.srcObject = _stream;
    document.body.appendChild(_video);
    await new Promise((resolve) => {
      _video.addEventListener("loadeddata", resolve, { once: true });
    });
    await _video.play().catch(() => {});
  })();
  await _initPromise;
  return { video: _video, stream: _stream };
}

export function releaseConsumer(consumerName) {
  _consumers.delete(consumerName);
  if (_consumers.size === 0 && _stream) {
    try { _stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    _video?.remove();
    _video = null;
    _stream = null;
    _initPromise = null;
  }
}

export function peekSharedWebcam() {
  return { video: _video, stream: _stream, consumerCount: _consumers.size };
}
