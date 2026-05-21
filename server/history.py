from __future__ import annotations

import httpx

from .models import ChatMessage, ChatSession, ServerConfig


def _readable(message: ChatMessage) -> str:
    image_note = f" [images:{len(message.image_ids)}]" if message.image_ids else ""
    return f"{message.role}: {message.content}{image_note}"


def build_prompt_context(session: ChatSession, messages: list[ChatMessage]) -> str:
    recent = "\n".join(_readable(message) for message in messages[-10:])
    summary = f"History summary:\n{session.summary}\n\n" if session.summary else ""
    return f"{summary}Recent conversation:\n{recent}".strip()


def _fallback_summary(previous: str, source: str) -> str:
    compact = " ".join(source.split())[-2500:]
    return "\n".join(part for part in [previous, compact] if part)[-4000:]


def maybe_compress_history(
    config: ServerConfig,
    session: ChatSession,
    messages: list[ChatMessage],
) -> str:
    if len(messages) <= config.history_keep_recent:
        return session.summary
    if sum(len(message.content) for message in messages) < config.history_compression_threshold:
        return session.summary

    older = messages[: -config.history_keep_recent]
    source = "\n".join(_readable(message) for message in older)[-50000:]
    if not config.api_key:
        return _fallback_summary(session.summary, source)

    try:
        payload = {
            "model": config.text_model,
            "input": [
                {
                    "role": "system",
                    "content": (
                        "You compress context for an image creation app. Preserve user preferences, "
                        "character/object details, style constraints, important image revisions, "
                        "and any facts needed for future image edits. Output concise Chinese."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Existing summary:\n{session.summary or 'None'}\n\nOld messages:\n{source}",
                },
            ],
        }
        headers = {"Authorization": f"Bearer {config.api_key}"}
        base_url = (config.base_url or "https://api.openai.com/v1").rstrip("/")
        with httpx.Client(timeout=60) as client:
            response = client.post(f"{base_url}/responses", json=payload, headers=headers)
            response.raise_for_status()
        summary = _extract_response_text(response.json())
        return summary or _fallback_summary(session.summary, source)
    except Exception:
        return _fallback_summary(session.summary, source)


def _extract_response_text(data: dict) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"].strip()
    chunks: list[str] = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            text = content.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "\n".join(chunks).strip()
