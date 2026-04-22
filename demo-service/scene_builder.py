"""
Prompt → scene graph JSON.

Uses Claude API (with prompt caching) if ANTHROPIC_API_KEY is set, else
falls back to a deterministic builder based on SHA-256 of the prompt.
"""
import hashlib
import json
import logging
import math
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5")

SYSTEM_PROMPT = """You are a 3D scene architect. Convert the user's description into a JSON scene graph for Blender.

OUTPUT RULES (strict):
- Output ONLY valid JSON. No explanation. No code fences.
- Frame count is always 48 (1 to 48, inclusive).
- Use only these primitive assets: cube, sphere, cylinder, cone, plane, torus, monkey.
- Positions in [x, y, z], color in [r, g, b, 1.0] with r/g/b in [0, 1].
- Include 1 camera, 1 light, 1-3 objects.
- Camera should orbit or pan cinematically with keyframes at frame 1 and 48.
- Objects should animate (rotation or position keyframes).
- Lights: type = "AREA" or "POINT" or "SUN".

SCHEMA:
{
  "camera": {
    "lens": 50,
    "keyframes": [
      {"frame": 1, "location": [x, y, z]},
      {"frame": 48, "location": [x, y, z]}
    ]
  },
  "light": {
    "type": "AREA",
    "location": [x, y, z],
    "energy": 1000,
    "size": 5.0,
    "color": [1.0, 1.0, 1.0]
  },
  "objects": [
    {
      "name": "obj1",
      "asset": "cube",
      "location": [x, y, z],
      "scale": [x, y, z],
      "color": [r, g, b, 1.0],
      "metallic": 0.0,
      "roughness": 0.5,
      "keyframes": [
        {"frame": 1, "rotation": [rx, ry, rz]},
        {"frame": 48, "rotation": [rx, ry, rz]}
      ]
    }
  ],
  "world": {
    "background": [0.02, 0.02, 0.04]
  }
}"""


def _seed_from_prompt(prompt: str) -> int:
    return int(hashlib.sha256(prompt.encode()).hexdigest()[:8], 16) & 0x7FFFFFFF


def _deterministic_fallback(prompt: str) -> dict[str, Any]:
    """Generate a reproducible scene graph without any LLM."""
    seed = _seed_from_prompt(prompt)

    # Pick primitive based on keyword or seed
    pl = prompt.lower()
    if "sphere" in pl or "ball" in pl or "planet" in pl:
        asset = "sphere"
    elif "cylinder" in pl or "pillar" in pl or "tube" in pl:
        asset = "cylinder"
    elif "cone" in pl or "pyramid" in pl:
        asset = "cone"
    elif "torus" in pl or "donut" in pl or "ring" in pl:
        asset = "torus"
    elif "monkey" in pl or "suzanne" in pl or "face" in pl:
        asset = "monkey"
    else:
        asset = ["cube", "sphere", "cylinder", "cone", "torus"][seed % 5]

    # Color from prompt keywords or seed
    color_map = {
        "red": [0.9, 0.1, 0.1, 1.0],
        "blue": [0.1, 0.3, 0.9, 1.0],
        "green": [0.1, 0.8, 0.2, 1.0],
        "yellow": [0.95, 0.85, 0.1, 1.0],
        "orange": [0.95, 0.5, 0.1, 1.0],
        "purple": [0.6, 0.1, 0.8, 1.0],
        "pink": [0.95, 0.3, 0.6, 1.0],
        "white": [0.95, 0.95, 0.95, 1.0],
        "gold": [0.9, 0.7, 0.2, 1.0],
        "silver": [0.8, 0.8, 0.85, 1.0],
    }
    color = None
    for name, rgba in color_map.items():
        if name in pl:
            color = rgba
            break
    if color is None:
        r = ((seed >> 0) & 0xFF) / 255.0
        g = ((seed >> 8) & 0xFF) / 255.0
        b = ((seed >> 16) & 0xFF) / 255.0
        color = [max(r, 0.2), max(g, 0.2), max(b, 0.2), 1.0]

    metallic = 0.7 if any(k in pl for k in ["metal", "gold", "silver", "chrome", "steel"]) else 0.1
    roughness = 0.1 if any(k in pl for k in ["shiny", "polished", "glossy", "mirror"]) else 0.5

    # Camera orbit
    radius = 7.0
    camera = {
        "lens": 50.0,
        "keyframes": [
            {"frame": 1, "location": [radius, -radius * 0.9, 4.0]},
            {"frame": 48, "location": [-radius, -radius * 0.3, 4.5]},
        ],
    }

    # Object rotation animation
    rot_speed = 2 * math.pi
    obj = {
        "name": "hero",
        "asset": asset,
        "location": [0.0, 0.0, 0.0],
        "scale": [1.0, 1.0, 1.0],
        "color": color,
        "metallic": metallic,
        "roughness": roughness,
        "keyframes": [
            {"frame": 1, "rotation": [0.0, 0.0, 0.0]},
            {"frame": 48, "rotation": [0.0, 0.0, rot_speed]},
        ],
    }

    # Light energy varies with prompt
    energy = 800.0 + (seed % 1200)
    light_pos = [4.0, -2.0, 6.0]
    if "dark" in pl or "night" in pl or "shadow" in pl:
        energy *= 0.4
        bg = [0.01, 0.01, 0.02]
    elif "bright" in pl or "sun" in pl or "day" in pl:
        energy *= 1.5
        bg = [0.4, 0.5, 0.6]
    else:
        bg = [0.05, 0.05, 0.08]

    return {
        "camera": camera,
        "light": {
            "type": "AREA",
            "location": light_pos,
            "energy": energy,
            "size": 5.0,
            "color": [1.0, 1.0, 1.0],
        },
        "objects": [obj],
        "world": {"background": bg},
    }


def _try_llm(prompt: str) -> dict[str, Any] | None:
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        resp = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1500,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()

        # Strip code fences if present
        if "```" in text:
            m = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
            if m:
                text = m.group(1)

        graph = json.loads(text)
        logger.info("LLM generated scene with %d objects", len(graph.get("objects", [])))
        return graph
    except Exception as exc:
        logger.warning("LLM scene generation failed, falling back: %s", exc)
        return None


def build_scene_graph(prompt: str) -> dict[str, Any]:
    """Public entry point: prompt → scene graph dict."""
    prompt = (prompt or "").strip() or "a cube spinning in light"
    graph = _try_llm(prompt)
    if graph is None:
        graph = _deterministic_fallback(prompt)

    # Always attach metadata
    graph["prompt"] = prompt
    graph["seed"] = _seed_from_prompt(prompt)
    graph["frame_count"] = 48
    graph["fps"] = 24
    graph["resolution"] = [512, 512]
    graph["samples"] = 16
    return graph
