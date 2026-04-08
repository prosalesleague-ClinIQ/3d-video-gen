"""
MVP heuristic frame scorer.

Deterministic, no ML. Scores each frame on four axes:
  - sharpness (Laplacian variance)
  - brightness_stability (mid-range exposure preference)
  - temporal_consistency (pixel delta vs previous frame)
  - composition (energy distribution across rule-of-thirds grid)

All scores normalized to [0, 1].
"""
import logging
import os
from urllib.parse import urlparse

import cv2
import numpy as np

from app.config import config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Image loading
# ---------------------------------------------------------------------------

def resolve_path(image_uri: str) -> str | None:
    if not image_uri:
        return None

    if image_uri.startswith("file://"):
        return image_uri[7:]

    if image_uri.startswith("s3://"):
        return _download_from_s3(image_uri)

    if os.path.isabs(image_uri) or os.path.exists(image_uri):
        return image_uri

    return None


def _download_from_s3(uri: str) -> str | None:
    if not config.OBJECT_STORAGE_ENABLED:
        logger.debug("Object storage disabled, cannot resolve %s", uri)
        return None
    try:
        from minio import Minio

        parsed = urlparse(uri)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        local_path = os.path.join("/tmp", "reward_cache", key)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        client = Minio(
            config.MINIO_ENDPOINT,
            access_key=config.MINIO_ACCESS_KEY,
            secret_key=config.MINIO_SECRET_KEY,
            secure=config.MINIO_SECURE,
        )
        client.fget_object(bucket, key, local_path)
        return local_path
    except Exception:
        logger.exception("Failed to download %s from object storage", uri)
        return None


def load_image(image_uri: str) -> np.ndarray | None:
    path = resolve_path(image_uri)
    if path is None:
        logger.warning("Cannot resolve image URI: %s", image_uri)
        return None
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        logger.warning("Failed to read image: %s", path)
    return img


# ---------------------------------------------------------------------------
# Individual scorers
# ---------------------------------------------------------------------------

def score_sharpness(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    # Normalize: 500+ is very sharp, 0 is flat
    return float(min(lap_var / 500.0, 1.0))


def score_brightness_stability(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    mean_brightness = gray.mean() / 255.0
    # Best at 0.5 (mid-range), penalize extremes
    # Score = 1.0 at mean=0.5, drops toward 0 at mean=0 or mean=1
    deviation = abs(mean_brightness - 0.5)
    return float(1.0 - (deviation * 2.0))


def score_temporal_consistency(current: np.ndarray, previous: np.ndarray | None) -> float:
    if previous is None:
        return 0.5  # neutral default

    cur_gray = cv2.cvtColor(current, cv2.COLOR_BGR2GRAY).astype(np.float32)
    prev_gray = cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY).astype(np.float32)

    # Resize if dimensions differ
    if cur_gray.shape != prev_gray.shape:
        prev_gray = cv2.resize(prev_gray, (cur_gray.shape[1], cur_gray.shape[0]))

    mean_delta = np.mean(np.abs(cur_gray - prev_gray))
    # Lower delta = more stable. 50+ pixel mean delta is very unstable
    return float(max(1.0 - (mean_delta / 50.0), 0.0))


def score_composition(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    h, w = gray.shape

    # Divide into 3x3 grid (rule of thirds)
    rh, rw = h // 3, w // 3
    cells = []
    for row in range(3):
        for col in range(3):
            cell = gray[row * rh:(row + 1) * rh, col * rw:(col + 1) * rw]
            cells.append(cell.mean())

    cells = np.array(cells)
    if cells.max() == 0:
        return 0.0

    cells_norm = cells / cells.max()

    # Reward: center cell has content (not empty black)
    center_score = cells_norm[4]  # center of 3x3

    # Reward: balanced energy spread (low std across cells)
    spread = cells_norm.std()
    balance_score = max(1.0 - spread * 2.0, 0.0)

    # Reward: non-zero cells (penalize frames that are mostly black)
    active_ratio = np.sum(cells_norm > 0.1) / 9.0

    return float(min(
        0.4 * center_score + 0.3 * balance_score + 0.3 * active_ratio,
        1.0,
    ))


# ---------------------------------------------------------------------------
# Composite scorer
# ---------------------------------------------------------------------------

WEIGHTS = {
    "sharpness": 0.35,
    "brightness_stability": 0.25,
    "temporal_consistency": 0.20,
    "composition": 0.20,
}


def score_frame(
    current: np.ndarray,
    previous: np.ndarray | None = None,
) -> tuple[float, dict[str, float]]:
    breakdown = {
        "sharpness": score_sharpness(current),
        "brightness_stability": score_brightness_stability(current),
        "temporal_consistency": score_temporal_consistency(current, previous),
        "composition": score_composition(current),
    }
    composite = sum(breakdown[k] * WEIGHTS[k] for k in WEIGHTS)
    composite = max(0.0, min(composite, 1.0))
    return composite, breakdown
