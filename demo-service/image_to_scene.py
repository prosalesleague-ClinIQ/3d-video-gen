"""
Photo → scene graph.

Accepts base64 image, analyzes it (Claude vision or Pillow fallback),
and feeds the result into scene_builder.build_scene_graph.
"""
import base64
import io
import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5")

VISION_SYSTEM_PROMPT = """You are a 3D scene designer. Describe the provided image as a 3D scene specification.

Output ONLY this JSON (no prose, no code fences):
{
  "subject": "short description of the main subject",
  "shape": "cube|sphere|cylinder|cone|torus|monkey",
  "colors": [[r, g, b], [r, g, b], ...],
  "lighting_style": "cinematic|soft|neon_glow|moody|high_key|sunset|cosmic",
  "mood": "psychedelic|dreamy|dramatic|intense|serene|surreal|mystical|chaotic",
  "camera_angle": "close-up|medium|wide|aerial|POV",
  "scene_description": "one sentence describing the scene as a prompt"
}

r, g, b are floats 0..1."""

SHOT_KEYWORDS = {
    "close-up": "intimate macro detail",
    "medium": "mid-shot",
    "wide": "sweeping wide establishing",
    "establishing": "sweeping establishing wide",
    "aerial": "bird's eye aerial",
    "POV": "first-person POV",
    "dolly_in": "dolly-in push",
    "dolly_out": "dolly-out pull back",
    "orbit": "orbiting",
}

LIGHTING_KEYWORDS = {
    "cinematic": "cinematic lighting",
    "soft": "soft ambient",
    "neon_glow": "neon glow",
    "moody": "moody low-key",
    "high_key": "bright high-key",
    "horror": "horror red",
    "sunset": "sunset warm",
    "cosmic": "cosmic dark",
}

MOOD_KEYWORDS = {
    "psychedelic": "psychedelic kaleidoscope",
    "dreamy": "ethereal dreamy",
    "dramatic": "cinematic dramatic",
    "intense": "intense dark",
    "serene": "calm peaceful",
    "surreal": "surreal abstract",
    "mystical": "magical mystical",
    "chaotic": "wild chaotic",
}


def _strip_data_url(image_str: str) -> tuple[str, str]:
    """Strip `data:image/png;base64,` prefix. Returns (mime, base64_raw)."""
    if image_str.startswith("data:"):
        m = re.match(r"data:(image/\w+);base64,(.+)$", image_str, re.DOTALL)
        if m:
            return m.group(1), m.group(2)
    return "image/jpeg", image_str  # assume jpeg if no prefix


def _strip_fences(text: str) -> str:
    text = text.strip()
    if "```" in text:
        m = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
        if m:
            return m.group(1).strip()
    return text


def describe_image_with_claude(image_base64: str, mime_type: str) -> dict | None:
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1200,
            system=[{
                "type": "text",
                "text": VISION_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type if mime_type.startswith("image/") else "image/jpeg",
                            "data": image_base64,
                        },
                    },
                    {"type": "text", "text": "Describe this image as a 3D scene. Output only the JSON spec."},
                ],
            }],
        )
        text = _strip_fences(response.content[0].text)
        parsed = json.loads(text)
        logger.info("Vision: subject=%r shape=%s mood=%s",
                    parsed.get("subject", "?"), parsed.get("shape"), parsed.get("mood"))
        return parsed
    except Exception as exc:
        logger.warning("Claude vision failed: %s", exc)
        return None


def fallback_image_analysis(image_bytes: bytes) -> dict:
    """Pillow-only analysis: dominant colors, brightness, aspect."""
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    # Downscale for speed
    img.thumbnail((160, 160))

    # Dominant colors via quantize
    quantized = img.quantize(colors=6)
    palette = quantized.getpalette()[:18]  # 6 colors × 3 channels
    counts = sorted(quantized.getcolors(), reverse=True)  # (count, index)
    colors = []
    for _, idx in counts[:5]:
        r = palette[idx * 3] / 255.0
        g = palette[idx * 3 + 1] / 255.0
        b = palette[idx * 3 + 2] / 255.0
        colors.append([r, g, b])

    # Brightness
    grayscale = img.convert("L")
    pixels = list(grayscale.getdata())
    brightness = sum(pixels) / (len(pixels) * 255.0)

    # Aspect ratio
    aspect = img.width / img.height if img.height else 1.0

    is_dark = brightness < 0.3
    is_bright = brightness > 0.65

    return {
        "colors": colors,
        "brightness": brightness,
        "aspect": aspect,
        "is_dark": is_dark,
        "is_bright": is_bright,
    }


def _build_synthesized_prompt(
    vision: dict | None,
    fallback: dict,
    direction: dict | None,
    prompt_hint: str,
) -> str:
    parts = []

    if vision:
        parts.append(vision.get("scene_description") or vision.get("subject") or "an image")
        if vision.get("shape"):
            parts.append(f"{vision['shape']} shape")
    else:
        parts.append("an abstract scene")

    # Direction keyword injection
    if direction:
        shot = direction.get("shot")
        if shot and shot in SHOT_KEYWORDS:
            parts.append(SHOT_KEYWORDS[shot])
        lighting = direction.get("lighting")
        if lighting and lighting in LIGHTING_KEYWORDS:
            parts.append(LIGHTING_KEYWORDS[lighting])
        mood = direction.get("mood")
        if mood and mood in MOOD_KEYWORDS:
            parts.append(MOOD_KEYWORDS[mood])

    # Vision-supplied style hints
    if vision:
        if vision.get("mood"):
            parts.append(vision["mood"])
        if vision.get("lighting_style"):
            parts.append(vision["lighting_style"])

    if fallback.get("is_dark"):
        parts.append("dark cosmic")
    if prompt_hint:
        parts.append(prompt_hint)

    return ", ".join(parts)


def _override_palette(graph: dict, colors: list[list[float]]) -> dict:
    """Recolor hero/ring/spiral objects with extracted image colors."""
    if not colors:
        return graph
    for obj in graph.get("objects", []):
        name = obj.get("name", "")
        idx = 0
        if name == "hero":
            idx = 0
        elif name.startswith("ring_"):
            try:
                idx = int(name.split("_")[1]) % len(colors)
            except Exception:
                idx = 0
        elif name.startswith("spiral_"):
            try:
                idx = (int(name.split("_")[1]) + 1) % len(colors)
            except Exception:
                idx = 1 % len(colors)
        else:
            continue
        c = colors[idx % len(colors)]
        obj["color"] = [c[0], c[1], c[2], 1.0]
        obj["emissive"] = [c[0] * 0.15, c[1] * 0.15, c[2] * 0.15]
    return graph


def image_to_scene_graph(
    image_input: str,
    direction: dict | None = None,
    prompt_hint: str = "",
) -> dict:
    """
    Orchestrator. Decode image, analyze, synthesize prompt, build scene,
    optionally override palette with extracted colors.
    """
    from scene_builder import build_scene_graph

    mime, b64 = _strip_data_url(image_input)
    try:
        image_bytes = base64.b64decode(b64)
    except Exception:
        logger.warning("Could not decode image base64")
        image_bytes = b""

    vision = describe_image_with_claude(b64, mime) if b64 else None
    fallback = fallback_image_analysis(image_bytes) if image_bytes else {"colors": [], "brightness": 0.5, "aspect": 1.0, "is_dark": False, "is_bright": False}

    synthesized = _build_synthesized_prompt(vision, fallback, direction, prompt_hint)
    logger.info("Image→prompt: %r", synthesized[:120])

    graph = build_scene_graph(synthesized)

    # If Claude didn't give us colors, use extracted fallback colors
    colors_to_apply = (vision.get("colors") if vision else None) or fallback.get("colors")
    if colors_to_apply:
        graph = _override_palette(graph, colors_to_apply[:4])

    # Dim background if image was dark
    if fallback.get("is_dark"):
        graph["world"]["background"] = [0.01, 0.01, 0.02]
        graph["world"]["fog_density"] = 0.02

    # Attach source metadata
    graph["_source"] = "image"
    graph["_direction"] = direction or {}
    return graph
