from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from .models import ServerConfig

load_dotenv()


def _positive_int(name: str, fallback: int) -> int:
    try:
        value = int(os.getenv(name, ""))
        return value if value > 0 else fallback
    except ValueError:
        return fallback


def load_config() -> ServerConfig:
    data_dir = Path(os.getenv("DATA_DIR", "./data")).resolve()
    return ServerConfig(
        api_key=os.getenv("OPENAI_API_KEY", ""),
        base_url=os.getenv("OPENAI_BASE_URL", ""),
        image_model=os.getenv("GPT_IMAGE_MODEL", "gpt-image-2"),
        text_model=os.getenv("OPENAI_TEXT_MODEL", "gpt-5.2"),
        data_dir=str(data_dir),
        database_url=os.getenv("DATABASE_URL", ""),
        history_compression_threshold=_positive_int("HISTORY_COMPRESSION_THRESHOLD", 12000),
        history_keep_recent=_positive_int("HISTORY_KEEP_RECENT", 10),
    )
