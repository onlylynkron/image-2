from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ImageQuality = Literal["auto", "low", "medium", "high"]
ImageSize = Literal["auto", "1024x1024", "1536x1024", "1024x1536"]
ImageFormat = Literal["png", "jpeg", "webp"]
MessageRole = Literal["user", "assistant", "system"]


class ServerConfig(BaseModel):
    api_key: str = ""
    base_url: str = ""
    image_model: str = "gpt-image-2"
    text_model: str = "gpt-5.2"
    data_dir: str = "./data"
    database_url: str = ""
    history_compression_threshold: int = 12000
    history_keep_recent: int = 10


class PublicConfig(BaseModel):
    base_url: str = ""
    image_model: str = "gpt-image-2"
    text_model: str = "gpt-5.2"
    has_api_key: bool = False
    storage_backend: str = "json"


class ServerConfigPatch(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    image_model: str | None = None
    text_model: str | None = None


class UserProfile(BaseModel):
    id: str
    display_name: str
    created_at: str
    updated_at: str


class ImageOptions(BaseModel):
    quality: ImageQuality = "auto"
    size: ImageSize = "1024x1024"
    format: ImageFormat = "png"
    compression: int = Field(default=85, ge=0, le=100)


class ImageAsset(BaseModel):
    id: str
    session_id: str
    message_id: str | None = None
    filename: str
    original_name: str | None = None
    mime_type: str
    kind: Literal["upload", "generated"]
    url: str
    created_at: str
    prompt: str | None = None
    options: ImageOptions | None = None


class ChatMessage(BaseModel):
    id: str
    session_id: str
    role: MessageRole
    content: str
    image_ids: list[str] = Field(default_factory=list)
    created_at: str
    meta: dict | None = None


class ChatSession(BaseModel):
    id: str
    title: str
    summary: str = ""
    summary_updated_at: str | None = None
    created_at: str
    updated_at: str
    options: ImageOptions = Field(default_factory=ImageOptions)


class Database(BaseModel):
    user: UserProfile
    sessions: list[ChatSession] = Field(default_factory=list)
    messages: list[ChatMessage] = Field(default_factory=list)
    images: list[ImageAsset] = Field(default_factory=list)


class GeneratePayload(BaseModel):
    prompt: str
    options: ImageOptions = Field(default_factory=ImageOptions)
    source_image_ids: list[str] = Field(default_factory=list)
    uploaded_image_ids: list[str] = Field(default_factory=list)


class SessionDetail(BaseModel):
    session: ChatSession
    messages: list[ChatMessage]
    images: list[ImageAsset]
