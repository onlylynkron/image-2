from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ImageQuality = Literal["auto", "low", "medium", "high"]
ImageSize = Literal["auto", "1024x1024", "1536x1024", "1024x1536"]
ImageFormat = Literal["png", "jpeg", "webp"]
ImageAspectRatio = Literal["auto", "1:1", "21:9", "16:9", "3:2", "4:3"]
ImageResolution = Literal["1K", "2K", "4K"]
MessageRole = Literal["user", "assistant", "system"]


class ServerConfig(BaseModel):
    api_key: str = ""
    base_url: str = ""
    image_model: str = "gpt-image-2"
    text_model: str = "gpt-5.2"
    google_client_id: str = ""
    data_dir: str = "./data"
    database_url: str = ""
    history_compression_threshold: int = 12000
    history_keep_recent: int = 10


class PublicConfig(BaseModel):
    base_url: str = ""
    image_model: str = "gpt-image-2"
    text_model: str = "gpt-5.2"
    has_api_key: bool = False
    google_auth_enabled: bool = False
    google_client_id: str = ""
    storage_backend: str = "json"


class ServerConfigPatch(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    image_model: str | None = None
    text_model: str | None = None
    google_client_id: str | None = None


class UserProfile(BaseModel):
    id: str
    username: str = ""
    display_name: str
    created_at: str
    updated_at: str
    password_hash: str | None = None


class ImageOptions(BaseModel):
    quality: ImageQuality = "high"
    size: ImageSize = "auto"
    aspect_ratio: ImageAspectRatio = "auto"
    resolution: ImageResolution = "1K"
    image_count: int = Field(default=1, ge=1, le=4)
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
    user_id: str | None = None
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
    image_count: int | None = Field(default=None, ge=1, le=4)


class SessionDetail(BaseModel):
    session: ChatSession
    messages: list[ChatMessage]
    images: list[ImageAsset]


class AuthPayload(BaseModel):
    username: str
    password: str


class GoogleAuthPayload(BaseModel):
    credential: str


class AuthUser(BaseModel):
    id: str
    username: str
    display_name: str


class AuthResponse(BaseModel):
    token: str
    user: AuthUser


class GuestImageSource(BaseModel):
    id: str
    filename: str
    original_name: str | None = None
    mime_type: str = "image/png"


class GuestGeneratePayload(GeneratePayload):
    source_images: list[GuestImageSource] = Field(default_factory=list)
    messages: list[ChatMessage] = Field(default_factory=list)
    summary: str = ""


class GuestChatPayload(BaseModel):
    content: str
    messages: list[ChatMessage] = Field(default_factory=list)
    summary: str = ""
    source_images: list[GuestImageSource] = Field(default_factory=list)


class IntentPayload(BaseModel):
    content: str
    selected_image_count: int = 0
    has_recent_image: bool = False


class IntentResult(BaseModel):
    intent: Literal["chat", "generate", "edit"]
    use_recent_image: bool = False
    reason: str = ""


class SyncPayload(BaseModel):
    sessions: list[SessionDetail] = Field(default_factory=list)
