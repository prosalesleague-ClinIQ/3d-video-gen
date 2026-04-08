import cv2
import numpy as np


def sharpness(image_path: str) -> float:
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    lap_var = cv2.Laplacian(img, cv2.CV_64F).var()
    return min(lap_var / 500.0, 1.0)


def brightness_consistency(image_path: str, target: float = 0.5) -> float:
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    mean_intensity = img.mean() / 255.0
    return 1.0 - abs(mean_intensity - target)


def delta_stability(current_path: str, previous_path: str | None) -> float:
    if previous_path is None:
        return 1.0
    curr = cv2.imread(current_path, cv2.IMREAD_GRAYSCALE)
    prev = cv2.imread(previous_path, cv2.IMREAD_GRAYSCALE)
    if curr is None or prev is None:
        return 1.0
    mean_delta = np.mean(np.abs(curr.astype(float) - prev.astype(float)))
    return 1.0 - min(mean_delta / 50.0, 1.0)


def composite_score(sharp: float, bright: float, delta: float) -> float:
    return 0.4 * sharp + 0.3 * bright + 0.3 * delta
