"""PNG frames → MP4 via ffmpeg subprocess."""
import logging
import os
import shutil
import subprocess

logger = logging.getLogger(__name__)


def compose(frame_dir: str, output_path: str, fps: int = 24) -> bool:
    pattern = os.path.join(frame_dir, "frame_%04d.png")

    ffmpeg = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
    cmd = [
        ffmpeg,
        "-y",
        "-framerate", str(fps),
        "-i", pattern,
        "-c:v", "libx264",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]
    logger.info("ffmpeg: %s", " ".join(cmd))

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        logger.error("ffmpeg failed: %s", result.stderr[-800:])
        return False

    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1000:
        logger.error("ffmpeg produced empty/missing output at %s", output_path)
        return False

    logger.info("Wrote %s (%d bytes)", output_path, os.path.getsize(output_path))
    return True
