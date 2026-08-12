"""Claude wrapper: persona-aware text generation used by every feature."""
from functools import lru_cache

from anthropic import Anthropic

import config


@lru_cache(maxsize=1)
def _client() -> Anthropic:
    return Anthropic(api_key=config.ANTHROPIC_API_KEY)


@lru_cache(maxsize=1)
def _persona_text() -> str:
    if config.PERSONA_PATH.exists():
        return config.PERSONA_PATH.read_text()
    return ""


def generate(system_suffix: str, user_prompt: str, max_tokens: int = 800) -> str:
    """Run a persona-grounded completion.

    system_suffix: task-specific instructions (e.g. "write a job outreach draft").
    user_prompt: the actual content/context for this call.
    """
    system = (
        "You are a personal assistant writing and reasoning AS the person "
        "described below would. Stay factual — never invent credentials, "
        "experience, or claims that aren't given to you in context.\n\n"
        f"{_persona_text()}\n\n---\n{system_suffix}"
    )
    resp = _client().messages.create(
        model=config.CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return "".join(block.text for block in resp.content if block.type == "text").strip()
