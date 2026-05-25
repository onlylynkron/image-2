from __future__ import annotations

import base64
import os
import re
import time
from pathlib import Path

import httpx

from .models import GeneratePayload, ImageAsset, ServerConfig

ASPECT_RATIO_SIZE_MAP = {
    "auto": "auto",
    "1:1": "1024x1024",
    "21:9": "1536x1024",
    "16:9": "1536x1024",
    "3:2": "1536x1024",
    "4:3": "1536x1024",
}

RETRYABLE_EXCEPTIONS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadError,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
    httpx.WriteError,
    httpx.WriteTimeout,
)
RETRYABLE_STATUS_CODES = {502, 503, 504}


def _mime_for_format(fmt: str) -> str:
    return {"jpeg": "image/jpeg", "webp": "image/webp"}.get(fmt, "image/png")


def _ext_for_format(fmt: str) -> str:
    return "jpg" if fmt == "jpeg" else fmt


def infer_image_count(prompt: str, requested_count: int | None = None) -> int:
    if requested_count and requested_count > 1:
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
    return 4 if any(hint in text for hint in multi_hints) else max(1, min(4, requested_count or 1))


def image_size_for_options(payload: GeneratePayload) -> str:
    if payload.options.size != "auto":
        return payload.options.size
    return ASPECT_RATIO_SIZE_MAP.get(payload.options.aspect_ratio, "auto")


def build_generation_constraints(payload: GeneratePayload) -> str:
    constraints = [
        f"Aspect ratio: {payload.options.aspect_ratio}",
        f"Resolution target: {payload.options.resolution}",
        f"Quality: {payload.options.quality}",
        f"Output format: {payload.options.format}",
    ]
    if payload.options.aspect_ratio != "auto":
        constraints.append("Compose the image to match the requested aspect ratio.")
    if payload.options.resolution != "1K":
        constraints.append(f"Render with {payload.options.resolution} level detail and clarity.")
    return "\n".join(constraints)


def _trust_env_proxy() -> bool:
    return os.getenv("OPENAI_HTTP_TRUST_ENV", "").strip().lower() in {"1", "true", "yes", "on"}


def _post_image_request(url: str, headers: dict[str, str], *, json=None, data=None, files=None) -> dict:
    last_error: Exception | None = None
    timeout = httpx.Timeout(connect=30, read=240, write=120, pool=30)
    for attempt in range(3):
        try:
            if files:
                for _field, file_info in files:
                    handle = file_info[1]
                    if hasattr(handle, "seek"):
                        handle.seek(0)
            with httpx.Client(timeout=timeout, trust_env=_trust_env_proxy()) as client:
                response = client.post(
                    url,
                    json=json,
                    data=data,
                    files=files,
                    headers={**headers, "Connection": "close"},
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            last_error = exc
            status_code = exc.response.status_code
            if status_code in RETRYABLE_STATUS_CODES and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            response_text = exc.response.text[:500]
            raise RuntimeError(
                f"Image service returned HTTP {status_code}: {response_text or exc.response.reason_phrase}"
            ) from exc
        except RETRYABLE_EXCEPTIONS as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            break

    if isinstance(last_error, httpx.RemoteProtocolError):
        raise RuntimeError(
            "Image service disconnected before sending a response. "
            "The request was retried, but the upstream service or proxy still closed the connection."
        ) from last_error
    if last_error:
        raise RuntimeError(f"Image service request failed after retries: {last_error}") from last_error
    raise RuntimeError("Image service request failed.")


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
            f"生成参数:\n{build_generation_constraints(payload)}",
            f"当前请求:\n{payload.prompt}",
        ]
        if part
    )
    body = {
        "model": config.image_model,
        "prompt": prompt,
        "quality": payload.options.quality,
        "size": image_size_for_options(payload),
        "output_format": payload.options.format,
    }
    image_count = infer_image_count(payload.prompt, payload.image_count or payload.options.image_count)
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
            return _post_image_request(
                f"{base_url}/images/edits",
                headers,
                data=body,
                files=files,
            )
        finally:
            for handle in handles:
                handle.close()

    return _post_image_request(
        f"{base_url}/images/generations",
        headers,
        json=body,
    )


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
