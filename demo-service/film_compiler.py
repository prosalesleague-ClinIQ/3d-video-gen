"""Stitch multiple MP4s into a single film via ffmpeg."""
import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)


def compile_film(video_paths: list[str], output_path: str, transition: str = "cut") -> bool:
    if not video_paths:
        logger.error("No videos to compile")
        return False

    ffmpeg = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"

    if transition == "cut" or len(video_paths) < 2:
        return _concat_cut(ffmpeg, video_paths, output_path)

    if transition in ("fade", "crossfade") and len(video_paths) == 2:
        return _crossfade_pair(ffmpeg, video_paths, output_path)

    logger.info("crossfade with 3+ videos not supported, using cut")
    return _concat_cut(ffmpeg, video_paths, output_path)


def _concat_cut(ffmpeg: str, video_paths: list[str], output_path: str) -> bool:
    list_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            list_path = f.name
            for p in video_paths:
                abs_p = os.path.abspath(p)
                if not os.path.exists(abs_p):
                    logger.error("Missing source video: %s", abs_p)
                    return False
                f.write(f"file '{abs_p}'\n")

        cmd = [
            ffmpeg, "-y",
            "-f", "concat", "-safe", "0",
            "-i", list_path,
            "-c:v", "libx264", "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path,
        ]
        logger.info("ffmpeg concat: %d clips → %s", len(video_paths), output_path)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            logger.error("ffmpeg concat failed: %s", result.stderr[-800:])
            return False
    finally:
        if list_path and os.path.exists(list_path):
            try:
                os.unlink(list_path)
            except Exception:
                pass

    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1000:
        logger.error("ffmpeg produced invalid output")
        return False
    return True


def _crossfade_pair(ffmpeg: str, video_paths: list[str], output_path: str) -> bool:
    a, b = video_paths[0], video_paths[1]
    cmd = [
        ffmpeg, "-y",
        "-i", a, "-i", b,
        "-filter_complex",
        "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=1.5,format=yuv420p",
        "-c:v", "libx264", "-crf", "23",
        "-movflags", "+faststart",
        output_path,
    ]
    logger.info("ffmpeg xfade: %s + %s", a, b)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        logger.error("ffmpeg xfade failed: %s", result.stderr[-800:])
        return False
    return os.path.exists(output_path) and os.path.getsize(output_path) > 1000
