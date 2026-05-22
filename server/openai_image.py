from __future__ import annotations

import base64
import re
from pathlib import Path

import httpx

from .models import GeneratePayload, ImageAsset, ServerConfig


def _mime_for_format(fmt: str) -> str:
    return {"jpeg": "image/jpeg", "webp": "image/webp"}.get(fmt, "image/png")


def _ext_for_format(fmt: str) -> str:
    return "jpg" if fmt == "jpeg" else fmt


def infer_image_count(prompt: str, requested_count: int | None = None) -> int:
    if requested_count:
        return max(1, min(4, requested_count))

    text = prompt.lower()
    digit_match = re.search(r"([1-4])\s*(?:张|个|幅|款|版|种|套|images?|pictures?|photos?|options?|variations?)", text)
    if digit_match:
        return int(digit_match.group(1))

    zh_numbers = {
        "一": 1,
        "两": 2,
        "二": 2,
        "三": 3,
        "四": 4,
    }
    for word, count in zh_numbers.items():
        if re.search(rf"{word}\s*(?:张|个|幅|款|版|种|套)", text):
            return count

    multi_hints = [
        "多张",
        "多个",
        "几张",
        "几版",
        "几款",
        "几种",
        "多方案",
        "multiple",
        "several",
        "variations",
    ]
    return 4 if any(hint in text for hint in multi_hints) else 1


def request_image(
    config: ServerConfig,
    payload: GeneratePayload,
    prompt_context: str,
    source_images: list[ImageAsset],
    image_path_for,
):
    prompt = "\n\n".join(
        part
        for part in [
            f"上下文参考:\n{prompt_context}" if prompt_context else "",
            f"当前请求:\n{payload.prompt}",
        ]
        if part
    )
    body = {
        "model": config.image_model,
        "prompt": prompt,
        "quality": payload.options.quality,
        "size": payload.options.size,
        "output_format": payload.options.format,
    }
    image_count = infer_image_count(payload.prompt, payload.image_count)
    if image_count > 1:
        body["n"] = image_count
    if payload.options.format != "png":
        body["output_compression"] = payload.options.compression

    base_url = (config.base_url or "https://api.openai.com/v1").rstrip("/")
    headers = {"Authorization": f"Bearer {config.api_key}"}
    if source_images:
        handles = []
        try:
            for asset in source_images:
                handles.append(Path(image_path_for(asset.filename)).open("rb"))
            files = [("image", (asset.original_name or asset.filename, handle, asset.mime_type))
                     for asset, handle in zip(source_images, handles)]
            with httpx.Client(timeout=180) as client:
                response = client.post(
                    f"{base_url}/images/edits",
                    data=body,
                    files=files,
                    headers=headers,
                )
                response.raise_for_status()
                return response.json()
        finally:
            for handle in handles:
                handle.close()

    with httpx.Client(timeout=180) as client:
        response = client.post(
            f"{base_url}/images/generations",
            json=body,
            headers=headers,
        )
        response.raise_for_status()
        return response.json()


def decode_image_results(result, fmt: str) -> list[tuple[bytes, str, str, str | None]]:
    items = []
    for data in result.get("data", []):
        b64 = data.get("b64_json") if data else None
        if not b64:
            continue
        items.append((
            base64.b64decode(b64),
            _mime_for_format(fmt),
            _ext_for_format(fmt),
            data.get("revised_prompt"),
        ))
    if not items:
        raise RuntimeError("OpenAI image response did not include base64 image data.")
    return items


def decode_image_result(result, fmt: str) -> tuple[bytes, str, str, str | None]:
    data = decode_image_results(result, fmt)[0]
    return data
    b64 = data.get("b64_json") if data else None
    if not b64:
        raise RuntimeError("OpenAI image response did not include base64 image data.")
    return (
        base64.b64decode(b64),
        _mime_for_format(fmt),
        _ext_for_format(fmt),
        data.get("revised_prompt"),
    )
