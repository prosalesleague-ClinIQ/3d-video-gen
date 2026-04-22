"""
Director AI: convert a vague prompt into full cinematic direction.

If the prompt is specific → returns enriched_prompt + shot list + palette + lighting + mood.
If vague → returns 1-3 clarifying questions for the user to answer.
"""
import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5")

DIRECTOR_SYSTEM_PROMPT = """You are a cinematic director AI for a 3D video generation system.

Given a user's prompt, decide:

(A) If the prompt is specific enough (has subject AND vibe), output:
{
  "type": "direction",
  "enriched_prompt": "richer prompt with color/lighting/mood/shape keywords that the scene builder can use",
  "shots": [
    {"type": "wide|close-up|aerial|orbit|dolly_in|dolly_out|POV", "duration_seconds": 1.5, "subject": "...", "motion": "..."},
    ...
  ],
  "palette": "cosmic|sunset|neon|forest|ocean|fire|mono|gold|chrome|candy",
  "lighting": "cinematic|soft|neon_glow|moody|high_key|horror|sunset|cosmic",
  "mood": "psychedelic|dreamy|dramatic|intense|serene|surreal|mystical|chaotic",
  "pace": "slow|medium|fast"
}

(B) If the prompt is vague, output (max 3 questions):
{
  "type": "questions",
  "questions": [
    {"id": "subject", "text": "What is the main subject?", "options": ["a floating crystal", "a spinning planet", "abstract flowing shapes"]},
    {"id": "mood", "text": "What feeling?", "options": ["dreamy", "intense", "psychedelic"]}
  ]
}

Rules:
- Output ONLY the JSON. No prose. No code fences.
- Options must be specific concrete examples, not categories.
- Prefer (A) when in doubt — only ask if critically missing.
"""


def _strip_fences(text: str) -> str:
    text = text.strip()
    if "```" in text:
        m = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
        if m:
            return m.group(1).strip()
    return text


def _call_claude(prompt: str, answers: dict | None = None) -> dict | None:
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        user = prompt
        if answers:
            user += "\n\nUser clarifications:\n" + "\n".join(f"- {k}: {v}" for k, v in answers.items())
            user += "\n\nReturn type=direction now — do NOT ask more questions."
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1500,
            system=[{
                "type": "text",
                "text": DIRECTOR_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user}],
        )
        text = _strip_fences(response.content[0].text)
        parsed = json.loads(text)
        if parsed.get("type") in ("direction", "questions"):
            return parsed
        return None
    except Exception as exc:
        logger.warning("Director AI Claude call failed: %s", exc)
        return None


def _deterministic_direction(prompt: str, answers: dict | None = None) -> dict:
    """Keyword-matching fallback. Always returns type=direction."""
    combined = prompt
    if answers:
        combined = prompt + " " + " ".join(str(v) for v in answers.values())
    pl = combined.lower()

    palette = "cosmic"
    if any(k in pl for k in ["sunset", "golden", "warm", "dusk"]): palette = "sunset"
    elif any(k in pl for k in ["neon", "synthwave", "cyberpunk", "80s"]): palette = "neon"
    elif any(k in pl for k in ["ocean", "water", "aqua", "sea"]): palette = "ocean"
    elif any(k in pl for k in ["fire", "lava", "hot", "flame"]): palette = "fire"
    elif any(k in pl for k in ["gold", "chrome", "metal", "silver", "brass"]): palette = "gold" if "gold" in pl else "chrome"
    elif any(k in pl for k in ["candy", "pastel", "pink", "rainbow"]): palette = "candy"
    elif any(k in pl for k in ["forest", "jungle", "nature", "green"]): palette = "forest"

    mood = "dreamy"
    if any(k in pl for k in ["psychedelic", "trippy", "kaleidoscope", "acid"]): mood = "psychedelic"
    elif any(k in pl for k in ["intense", "dramatic", "epic"]): mood = "dramatic"
    elif any(k in pl for k in ["dark", "horror", "scary", "ominous"]): mood = "intense"
    elif any(k in pl for k in ["calm", "peaceful", "serene", "tranquil"]): mood = "serene"
    elif any(k in pl for k in ["surreal", "weird", "strange"]): mood = "surreal"
    elif any(k in pl for k in ["mystical", "magical", "ethereal"]): mood = "mystical"
    elif any(k in pl for k in ["chaos", "chaotic", "wild"]): mood = "chaotic"

    lighting = "cinematic"
    if "neon" in pl: lighting = "neon_glow"
    elif any(k in pl for k in ["horror", "scary", "dark"]): lighting = "moody"
    elif "sunset" in pl: lighting = "sunset"
    elif any(k in pl for k in ["bright", "day", "sunny"]): lighting = "high_key"
    elif any(k in pl for k in ["cosmic", "space", "galaxy"]): lighting = "cosmic"

    pace = "medium"
    if any(k in pl for k in ["slow", "calm", "drift", "gentle"]): pace = "slow"
    elif any(k in pl for k in ["fast", "quick", "rapid", "rush", "frantic"]): pace = "fast"

    return {
        "type": "direction",
        "enriched_prompt": f"{prompt}, {palette} palette, {mood} mood, {lighting} lighting, {pace} pace",
        "shots": [
            {"type": "wide", "duration_seconds": 2.0, "subject": "establishing shot", "motion": "slow orbit"},
            {"type": "close-up", "duration_seconds": 1.0, "subject": "hero element", "motion": "dolly_in"},
        ],
        "palette": palette,
        "lighting": lighting,
        "mood": mood,
        "pace": pace,
    }


def interpret_prompt(prompt: str, answers: dict | None = None) -> dict:
    """
    Main entry. Returns {"type": "direction", ...} or {"type": "questions", ...}.
    """
    if not prompt or not prompt.strip():
        prompt = "a cosmic kaleidoscope of light"

    claude_result = _call_claude(prompt, answers)
    if claude_result is not None:
        return claude_result
    return _deterministic_direction(prompt, answers)
