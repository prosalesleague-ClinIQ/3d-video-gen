"""
Stitches rendered PNG frames into an MP4 video using ffmpeg.
"""
import glob
import logging
import os
import subprocess

from app.config import config

logger = logging.getLogger(__name__)


def find_frames(render_id: str) -> list[str]:
    """Find all frame PNGs for a render, sorted by frame number."""
    # Check both naming conventions from old and new workers
    patterns = [
        os.path.join(config.FRAME_ROOT, render_id, "frame_*.png"),
        os.path.join(config.FRAME_ROOT, render_id, "*.png"),
    ]
    frames = []
    for pattern in patterns:
        frames = sorted(glob.glob(pattern))
        if frames:
            break
    return frames


def assemble_video(render_id: str, scene_id: str) -> str | None:
    """
    Stitch frames into MP4. Returns output path on success, None on failure.
    """
    frames = find_frames(render_id)
    if not frames:
        logger.error("No frames found for render_id=%s", render_id)
        return None

    logger.info("Found %d frames for render_id=%s", len(frames), render_id)

    os.makedirs(config.VIDEO_OUTPUT_PATH, exist_ok=True)
    output_path = os.path.join(config.VIDEO_OUTPUT_PATH, f"{render_id}.mp4")

    # Detect frame naming pattern for ffmpeg
    first = os.path.basename(frames[0])
    frame_dir = os.path.dirname(frames[0])

    if first.startswith("frame_"):
        input_pattern = os.path.join(frame_dir, "frame_%04d.png")
    else:
        input_pattern = os.path.join(frame_dir, "%04d.png")

    cmd = [
        config.FFMPEG_BINARY,
        "-y",                          # overwrite
        "-framerate", str(config.FPS),
        "-i", input_pattern,
        "-c:v", config.VIDEO_CODEC,
        "-crf", config.VIDEO_QUALITY,
        "-pix_fmt", "yuv420p",         # compatibility
        "-movflags", "+faststart",     # web-friendly
        output_path,
    ]

    logger.info("Running: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            logger.error("ffmpeg failed (rc=%d): %s", result.returncode, result.stderr[-500:])
            return None

        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        logger.info(
            "Video assembled: %s (%.1f MB, %d frames @ %d fps)",
            output_path, size_mb, len(frames), config.FPS,
        )
        return output_path

    except subprocess.TimeoutExpired:
        logger.error("ffmpeg timed out for render_id=%s", render_id)
        return None
    except FileNotFoundError:
        logger.error("ffmpeg not found at '%s'", config.FFMPEG_BINARY)
        return None
