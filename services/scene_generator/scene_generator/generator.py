"""
Scene graph generator.

Attempts to use Claude API to convert natural language prompts into rich 3D
scene graphs. Falls back to deterministic default if API is unavailable or
ANTHROPIC_API_KEY is not set.
"""
import hashlib
import json
import logging
import math
import os
from uuid import uuid5, NAMESPACE_URL

from shared.schemas import (
    SceneGraph, CameraParams, ObjectParams, LightParams, Keyframe,
)

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

SCENE_GRAPH_PROMPT = """You are a 3D scene architect. Convert the user's description into a JSON scene graph.

Rules:
- Output ONLY valid JSON, no explanation
- Use Blender-compatible primitives: cube, sphere, cylinder, cone, plane
- All positions in [x, y, z] format
- Keyframes use 1-indexed frame numbers (1 to 240)
- Camera should orbit or move cinematically
- Include at least one light (type: area, point, or sun)
- Keep it achievable with basic Blender primitives
- Be creative with animation — objects should move, rotate, or scale

Output this exact JSON structure:
{
  "cameras": [
    {
      "id": "cam_main",
      "lens": 50,
      "path": [
        {"frame": 1, "pos": [x, y, z]},
        {"frame": 240, "pos": [x, y, z]}
      ]
    }
  ],
  "objects": [
    {
      "id": "unique_name",
      "asset": "cube|sphere|cylinder|cone|plane",
      "position": [x, y, z],
      "scale": [x, y, z],
      "color": [r, g, b, 1.0],
      "keyframes": [
        {"frame": 1, "type": "rotation", "value": [rx, ry, rz]},
        {"frame": 240, "type": "rotation", "value": [rx, ry, rz]}
      ]
    }
  ],
  "lights": [
    {
      "id": "light_main",
      "type": "area",
      "position": [x, y, z],
      "energy": 1000,
      "size": 5.0
    }
  ]
}"""


def _seed_from_prompt(prompt: str) -> int:
    return int(hashlib.sha256(prompt.encode()).hexdigest()[:8], 16)


def _scene_id_from_seed(prompt: str, seed: int):
    return uuid5(NAMESPACE_URL, f"{prompt}-{seed}")


def _llm_generate(prompt: str) -> dict | None:
    """Call Claude API to generate scene graph JSON. Returns parsed dict or None."""
    if not ANTHROPIC_API_KEY:
        logger.info("No ANTHROPIC_API_KEY set, using deterministic fallback")
        return None

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system=SCENE_GRAPH_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        text = response.content[0].text.strip()
        # Extract JSON if wrapped in markdown
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        parsed = json.loads(text)
        logger.info("LLM generated scene with %d objects, %d lights",
                     len(parsed.get("objects", [])), len(parsed.get("lights", [])))
        return parsed

    except Exception:
        logger.exception("LLM scene generation failed, using fallback")
        return None


def _llm_dict_to_scene_graph(prompt: str, seed: int, scene_id, llm_data: dict) -> SceneGraph:
    """Convert LLM output dict into a SceneGraph."""
    # Camera
    cam_data = (llm_data.get("cameras") or [{}])[0]
    cam_path = cam_data.get("path", [])
    cam_keyframes = [Keyframe(frame=kf["frame"], value=kf["pos"]) for kf in cam_path]
    camera = CameraParams(
        position=cam_path[0]["pos"] if cam_path else [7.36, -6.93, 4.96],
        rotation=[1.1093, 0.0, 0.8149],
        lens=cam_data.get("lens", 50.0),
        keyframes=cam_keyframes,
    )

    # Objects
    objects = []
    for obj_data in llm_data.get("objects", []):
        kfs = []
        for kf in obj_data.get("keyframes", []):
            kfs.append(Keyframe(frame=kf["frame"], value=kf.get("value", [0, 0, 0])))

        objects.append(ObjectParams(
            name=obj_data.get("id", "Object"),
            obj_type=obj_data.get("asset", "cube").upper(),
            position=obj_data.get("position", [0, 0, 0]),
            scale=obj_data.get("scale", [1, 1, 1]),
            color=obj_data.get("color", [0.8, 0.2, 0.2, 1.0]),
            keyframes=kfs,
        ))

    if not objects:
        objects = [_default_object(seed)]

    # Lights
    light_data = (llm_data.get("lights") or [{}])[0]
    light = LightParams(
        position=light_data.get("position", [4.08, 1.0, 5.90]),
        energy=light_data.get("energy", 1000.0),
        light_type=light_data.get("type", "AREA").upper(),
        size=light_data.get("size", 5.0),
    )

    return SceneGraph(
        scene_id=scene_id,
        prompt=prompt,
        seed=seed,
        camera=camera,
        objects=objects,
        light=light,
    )


def _default_object(seed: int) -> ObjectParams:
    r = ((seed >> 0) & 0xFF) / 255.0
    g = ((seed >> 8) & 0xFF) / 255.0
    b = ((seed >> 16) & 0xFF) / 255.0
    return ObjectParams(
        name="Cube",
        obj_type="CUBE",
        position=[0.0, 0.0, 0.0],
        scale=[1.0, 1.0, 1.0],
        color=[r, g, b, 1.0],
        keyframes=[
            Keyframe(frame=1, value=[0.0, 0.0, 0.0]),
            Keyframe(frame=240, value=[0.0, 0.0, 2 * math.pi]),
        ],
    )


def _default_scene_graph(prompt: str) -> SceneGraph:
    """Deterministic fallback — always produces the same scene for the same prompt."""
    return SceneGraph.from_prompt(prompt)


def build_scene_graph(prompt: str) -> SceneGraph:
    """
    Generate a scene graph from a text prompt.

    1. Try LLM generation via Claude API
    2. Fall back to deterministic default if unavailable
    """
    seed = _seed_from_prompt(prompt)
    scene_id = _scene_id_from_seed(prompt, seed)

    llm_data = _llm_generate(prompt)
    if llm_data:
        try:
            return _llm_dict_to_scene_graph(prompt, seed, scene_id, llm_data)
        except Exception:
            logger.exception("Failed to parse LLM scene graph, using fallback")

    return _default_scene_graph(prompt)
