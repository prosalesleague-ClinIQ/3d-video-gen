"""
Prompt → rich scene graph JSON.

Produces cinematic multi-object scenes: kaleidoscope arrays, layered depth,
flythrough camera paths, and per-object materials.

Uses Claude API (with prompt caching) if ANTHROPIC_API_KEY is set. Always
falls back to a rich deterministic builder that mirrors-and-arrays a hero
primitive through the scene.
"""
import hashlib
import json
import logging
import math
import os
import random
import re
from typing import Any

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5")

SYSTEM_PROMPT = """You are a cinematic 3D scene architect. Produce a rich kaleidoscope scene graph for a 3-second flythrough.

Rules:
- Output ONLY JSON. No explanation.
- Include 10-30 objects arranged in kaleidoscope symmetry (rings, spirals, mirrored pairs).
- 2-4 lights at different heights/colors.
- Camera follows a curved flythrough path (6+ keyframes over frames 1-72).
- Each object animates (rotation, float, or pulse).
- Assets: cube, sphere, cylinder, cone, plane, torus, monkey.
- Colors are [r,g,b,1.0] with r/g/b in [0,1].
- Positions in [x,y,z] world units (scene radius ~8).

Schema:
{
  "camera": {
    "lens": 35,
    "keyframes": [
      {"frame": 1,  "location": [x,y,z], "look_at": [x,y,z]},
      {"frame": 72, "location": [x,y,z], "look_at": [x,y,z]}
    ]
  },
  "lights": [
    {"type": "AREA|POINT|SUN", "location": [x,y,z], "energy": float, "color": [r,g,b]}
  ],
  "objects": [
    {
      "name": "o1",
      "asset": "sphere",
      "location": [x,y,z],
      "scale": [x,y,z],
      "color": [r,g,b,1.0],
      "metallic": 0.0-1.0,
      "roughness": 0.0-1.0,
      "emissive": [r,g,b],
      "keyframes": [
        {"frame": 1,  "rotation": [rx,ry,rz], "location": [x,y,z]},
        {"frame": 72, "rotation": [rx,ry,rz], "location": [x,y,z]}
      ]
    }
  ],
  "world": { "background": [r,g,b], "fog_density": 0.0-0.1 }
}"""


COLOR_PALETTES = {
    "cosmic":   [[0.6, 0.2, 0.9], [0.2, 0.4, 0.95], [0.9, 0.3, 0.7], [0.1, 0.85, 0.95]],
    "sunset":   [[0.95, 0.4, 0.2], [0.95, 0.7, 0.3], [0.85, 0.2, 0.5], [0.5, 0.2, 0.8]],
    "neon":     [[0.1, 1.0, 0.7], [1.0, 0.2, 0.6], [0.3, 0.5, 1.0], [1.0, 0.9, 0.1]],
    "forest":   [[0.2, 0.7, 0.3], [0.4, 0.85, 0.2], [0.7, 0.95, 0.3], [0.1, 0.5, 0.35]],
    "ocean":    [[0.1, 0.4, 0.7], [0.2, 0.7, 0.85], [0.05, 0.25, 0.5], [0.6, 0.9, 0.95]],
    "fire":     [[0.95, 0.3, 0.1], [0.95, 0.6, 0.1], [0.9, 0.1, 0.1], [1.0, 0.85, 0.2]],
    "mono":     [[0.95, 0.95, 0.95], [0.2, 0.2, 0.25], [0.55, 0.55, 0.6], [0.8, 0.8, 0.85]],
    "gold":     [[0.95, 0.75, 0.2], [0.85, 0.55, 0.1], [0.7, 0.4, 0.1], [1.0, 0.9, 0.5]],
    "chrome":   [[0.88, 0.88, 0.92], [0.7, 0.7, 0.8], [0.6, 0.65, 0.75], [0.95, 0.95, 1.0]],
    "candy":    [[0.95, 0.5, 0.75], [0.85, 0.3, 0.95], [0.4, 0.95, 0.8], [0.95, 0.95, 0.3]],
}

ASSET_KEYWORDS = {
    "cube":     ["cube", "box", "block", "brick", "crystal"],
    "sphere":   ["sphere", "ball", "planet", "orb", "bubble", "pearl"],
    "cylinder": ["cylinder", "pillar", "column", "tube", "pipe"],
    "cone":     ["cone", "pyramid", "spike", "spire"],
    "torus":    ["torus", "ring", "donut", "loop"],
    "monkey":   ["monkey", "suzanne", "face", "head"],
    "plane":    ["plane", "ground", "floor", "tile"],
}


def _seed_from_prompt(prompt: str) -> int:
    return int(hashlib.sha256(prompt.encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


def _pick_palette(pl: str, seed: int) -> list[list[float]]:
    for name, palette in COLOR_PALETTES.items():
        if name in pl:
            return palette
    keyword_map = [
        (["space", "galaxy", "nebula", "star", "cosmic"], "cosmic"),
        (["sunset", "dusk", "warm", "golden hour"], "sunset"),
        (["neon", "cyberpunk", "retro", "80s", "synthwave"], "neon"),
        (["forest", "nature", "jungle", "leaf", "tree"], "forest"),
        (["ocean", "sea", "water", "wave", "aqua"], "ocean"),
        (["fire", "flame", "lava", "hot", "volcano"], "fire"),
        (["gold", "brass"], "gold"),
        (["chrome", "silver", "metal", "steel", "mirror"], "chrome"),
        (["pink", "candy", "pastel", "rainbow"], "candy"),
        (["black", "white", "monochrome", "minimal"], "mono"),
    ]
    for keywords, name in keyword_map:
        if any(k in pl for k in keywords):
            return COLOR_PALETTES[name]
    palettes = list(COLOR_PALETTES.values())
    return palettes[seed % len(palettes)]


def _pick_hero_asset(pl: str, seed: int) -> str:
    for asset, keywords in ASSET_KEYWORDS.items():
        for kw in keywords:
            if kw in pl:
                return asset
    assets = ["cube", "sphere", "torus", "cone", "cylinder"]
    return assets[seed % len(assets)]


def _deterministic_fallback(prompt: str) -> dict[str, Any]:
    """Rich kaleidoscope scene. Same prompt → same scene (seeded random)."""
    seed = _seed_from_prompt(prompt)
    rng = random.Random(seed)

    pl = prompt.lower()
    palette = _pick_palette(pl, seed)
    hero_asset = _pick_hero_asset(pl, seed)

    is_metal = any(k in pl for k in ["metal", "chrome", "steel", "gold", "silver", "brass"])
    is_glossy = any(k in pl for k in ["shiny", "glossy", "polished", "mirror", "crystal"])
    is_dark = any(k in pl for k in ["dark", "night", "shadow", "black"])
    is_cosmic = any(k in pl for k in ["space", "cosmic", "galaxy", "nebula", "star"])

    if is_dark or is_cosmic:
        background = [0.015, 0.015, 0.03]
        fog_density = 0.015
    else:
        background = [0.06, 0.07, 0.1]
        fog_density = 0.005

    metallic = 0.85 if is_metal else 0.15
    roughness = 0.08 if is_glossy else 0.4

    objects: list[dict[str, Any]] = []

    # Centerpiece (hero)
    hero_color = [*palette[0], 1.0]
    objects.append({
        "name": "hero",
        "asset": hero_asset,
        "location": [0.0, 0.0, 0.0],
        "scale": [1.4, 1.4, 1.4],
        "color": hero_color,
        "metallic": metallic,
        "roughness": roughness,
        "emissive": [palette[0][0] * 0.15, palette[0][1] * 0.15, palette[0][2] * 0.15],
        "keyframes": [
            {"frame": 1, "rotation": [0, 0, 0], "location": [0, 0, 0]},
            {"frame": 72, "rotation": [2 * math.pi, math.pi, 2 * math.pi], "location": [0, 0, 0]},
        ],
    })

    # Kaleidoscope ring — 12 mirrored objects
    ring_count = 12
    ring_radius = 5.5
    ring_asset = rng.choice(["sphere", "cube", "cone", "torus", "cylinder"])
    for i in range(ring_count):
        angle = (i / ring_count) * 2 * math.pi
        x = ring_radius * math.cos(angle)
        y = ring_radius * math.sin(angle)
        z = 0.5 * math.sin(angle * 3)
        color_base = palette[i % len(palette)]
        scale = 0.6 + 0.3 * abs(math.sin(angle * 2))
        objects.append({
            "name": f"ring_{i}",
            "asset": ring_asset,
            "location": [x, y, z],
            "scale": [scale, scale, scale],
            "color": [*color_base, 1.0],
            "metallic": metallic,
            "roughness": roughness,
            "emissive": [c * 0.1 for c in color_base],
            "keyframes": [
                {"frame": 1, "rotation": [0, 0, angle], "location": [x, y, z]},
                {"frame": 72, "rotation": [math.pi * 2, 0, angle + math.pi * 2],
                 "location": [x, y, z + 1.0 * math.sin(angle)]},
            ],
        })

    # Inner spiral — 8 smaller objects
    spiral_count = 8
    spiral_asset = rng.choice(["sphere", "cube", "torus"])
    for i in range(spiral_count):
        t = i / spiral_count
        angle = t * 4 * math.pi
        r = 2.0 + t * 1.5
        x = r * math.cos(angle)
        y = r * math.sin(angle)
        z = -1.5 + t * 3.0
        color_base = palette[(i + 1) % len(palette)]
        objects.append({
            "name": f"spiral_{i}",
            "asset": spiral_asset,
            "location": [x, y, z],
            "scale": [0.35, 0.35, 0.35],
            "color": [*color_base, 1.0],
            "metallic": metallic * 0.9,
            "roughness": roughness,
            "emissive": [c * 0.3 for c in color_base],
            "keyframes": [
                {"frame": 1, "rotation": [0, 0, 0], "location": [x, y, z]},
                {"frame": 72, "rotation": [math.pi * 4, math.pi * 2, 0],
                 "location": [x * 0.7, y * 0.7, z + 0.5]},
            ],
        })

    # Back depth markers — 6 cubes in outer ring
    for i in range(6):
        angle = (i / 6) * 2 * math.pi
        r = 8.5
        x = r * math.cos(angle)
        y = r * math.sin(angle)
        z = -2 + i * 0.5
        color_base = palette[i % len(palette)]
        objects.append({
            "name": f"back_{i}",
            "asset": "cube",
            "location": [x, y, z],
            "scale": [0.9, 0.9, 0.9],
            "color": [c * 0.5 for c in color_base] + [1.0],
            "metallic": 0.6,
            "roughness": 0.5,
            "emissive": [0, 0, 0],
            "keyframes": [
                {"frame": 1, "rotation": [angle, 0, 0], "location": [x, y, z]},
                {"frame": 72, "rotation": [angle + math.pi, math.pi, 0], "location": [x, y, z]},
            ],
        })

    # 3-point lighting + accent
    lights = [
        {
            "type": "AREA",
            "location": [4, -4, 6],
            "energy": 1400 if not is_dark else 800,
            "size": 4.0,
            "color": [1.0, 0.95, 0.85],
        },
        {
            "type": "POINT",
            "location": [-5, 3, 4],
            "energy": 800,
            "color": palette[0],
        },
        {
            "type": "POINT",
            "location": [0, 5, -3],
            "energy": 600,
            "color": palette[1 if len(palette) > 1 else 0],
        },
    ]

    # Flythrough camera path — 6 keyframes, swoop in + orbit + pull out
    cam_path = []
    radius = 10
    for t in [0.0, 0.15, 0.35, 0.55, 0.75, 1.0]:
        frame = 1 + int(t * 71)
        angle = t * 2 * math.pi + seed * 0.01
        r = radius * (1.2 - 0.4 * math.sin(t * math.pi))
        height = 2.5 + 2.0 * math.sin(t * math.pi)
        cam_path.append({
            "frame": frame,
            "location": [r * math.cos(angle), r * math.sin(angle), height],
            "look_at": [0, 0, 0],
        })

    camera = {"lens": 35.0, "keyframes": cam_path}

    return {
        "camera": camera,
        "lights": lights,
        "objects": objects,
        "world": {"background": background, "fog_density": fog_density},
    }


def _try_llm(prompt: str) -> dict[str, Any] | None:
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        resp = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=4000,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        if "```" in text:
            m = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
            if m:
                text = m.group(1)
        graph = json.loads(text)
        if not all(k in graph for k in ("camera", "objects")):
            return None
        if "light" in graph and "lights" not in graph:
            graph["lights"] = [graph.pop("light")]
        logger.info("LLM generated scene: %d objects, %d lights",
                     len(graph.get("objects", [])), len(graph.get("lights", [])))
        return graph
    except Exception as exc:
        logger.warning("LLM scene generation failed: %s", exc)
        return None


def build_scene_graph(prompt: str) -> dict[str, Any]:
    """Prompt → rich scene graph dict."""
    prompt = (prompt or "").strip() or "a cosmic kaleidoscope of light"
    graph = _try_llm(prompt)
    if graph is None:
        graph = _deterministic_fallback(prompt)

    graph["prompt"] = prompt
    graph["seed"] = _seed_from_prompt(prompt)
    graph["frame_count"] = graph.get("frame_count", 72)
    graph["fps"] = graph.get("fps", 24)
    graph["resolution"] = graph.get("resolution", [640, 640])
    graph["samples"] = graph.get("samples", 16)
    return graph
