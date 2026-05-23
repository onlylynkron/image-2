from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from pathlib import Path

import httpx

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import load_config
from .history import build_prompt_context, maybe_compress_history
from .models import (
    AuthPayload,
    AuthResponse,
    AuthUser,
    ChatSession,
    GeneratePayload,
    GuestChatPayload,
    GuestGeneratePayload,
    ImageAsset,
    ServerConfigPatch,
    SessionDetail,
    SyncPayload,
    UserProfile,
)
from .openai_image import decode_image_results, request_image
from .storage import DEFAULT_SESSION_TITLE, create_store, now_iso

config = load_config()
store = create_store(config)
store.init()

app = FastAPI(title="Image Studio API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets", StaticFiles(directory=str(Path(config.data_dir) / "images")), name="assets")

TOKEN_SECRET = hashlib.sha256(f"{config.database_url}:{config.data_dir}:image2".encode("utf-8")).digest()


def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"{salt}${digest.hex()}"


def _verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash or "$" not in password_hash:
        return False
    salt, expected = password_hash.split("$", 1)
    return hmac.compare_digest(_hash_password(password, salt), f"{salt}${expected}")


def _make_token(user_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"user_id": user_id}).encode("utf-8")).decode("ascii").rstrip("=")
    signature = hmac.new(TOKEN_SECRET, payload.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def _read_token(token: str) -> str | None:
    if "." not in token:
        return None
    payload, signature = token.rsplit(".", 1)
    expected = hmac.new(TOKEN_SECRET, payload.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        padded = payload + "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        return data.get("user_id")
    except Exception:
        return None


def _auth_user(user: UserProfile) -> AuthUser:
    return AuthUser(id=user.id, username=user.username, display_name=user.display_name)


def _normalize_username(username: str) -> str:
    value = username.strip().lower()
    if len(value) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
    return value


def require_user(authorization: str | None = Header(default=None)) -> UserProfile:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Please login first.")
    user_id = _read_token(token)
    user = store.get_user(user_id) if user_id else None
    if not user:
        raise HTTPException(status_code=401, detail="Invalid login session.")
    return user


@app.get("/api/health")
def health():
    return {"ok": True, "config": store.public_config()}


@app.get("/api/config")
def get_config():
    return store.public_config()


@app.put("/api/config")
def update_config(patch: ServerConfigPatch):
    return store.update_config(patch)


@app.post("/api/auth/register", response_model=AuthResponse, status_code=201)
def register(payload: AuthPayload):
    username = _normalize_username(payload.username)
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if store.find_user_by_username(username):
        raise HTTPException(status_code=409, detail="Username already exists.")
    user = store.create_user(username, _hash_password(payload.password))
    return AuthResponse(token=_make_token(user.id), user=_auth_user(user))


@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: AuthPayload):
    username = _normalize_username(payload.username)
    user = store.find_user_by_username(username)
    if not user or not _verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    return AuthResponse(token=_make_token(user.id), user=_auth_user(user))


@app.get("/api/auth/me", response_model=AuthUser)
def me(user: UserProfile = Depends(require_user)):
    return _auth_user(user)


@app.get("/api/sessions")
def list_sessions(user: UserProfile = Depends(require_user)):
    return store.list_sessions(user.id)


@app.post("/api/sessions", status_code=201)
def create_session(payload: dict | None = None, user: UserProfile = Depends(require_user)):
    return store.create_session((payload or {}).get("title") or DEFAULT_SESSION_TITLE, user.id)


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str, user: UserProfile = Depends(require_user)):
    session = store.get_session(session_id, user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: str, payload: dict, user: UserProfile = Depends(require_user)):
    session = store.update_session(session_id, user_id=user.id, **payload)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/api/sessions/{session_id}/history")
def clear_session_history(session_id: str, user: UserProfile = Depends(require_user)):
    if not store.get_session(session_id, user.id):
        raise HTTPException(status_code=404, detail="Session not found")
    if not store.clear_session_history(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str, user: UserProfile = Depends(require_user)):
    if not store.get_session(session_id, user.id):
        raise HTTPException(status_code=404, detail="Session not found")
    if not store.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True, "sessions": store.list_sessions(user.id)}


@app.post("/api/sessions/{session_id}/uploads", status_code=201)
async def upload_images(
    session_id: str,
    images: list[UploadFile] = File(...),
    user: UserProfile = Depends(require_user),
):
    if not store.get_session(session_id, user.id):
        raise HTTPException(status_code=404, detail="Session not found")

    saved = []
    for image in images[:6]:
        content = await image.read()
        mime = image.content_type or "image/png"
        ext = "webp" if "webp" in mime else "jpg" if "jpeg" in mime or "jpg" in mime else "png"
        filename = store.save_image_file(content, ext)
        saved.append(
            store.add_image(
                session_id=session_id,
                filename=filename,
                original_name=image.filename,
                mime_type=mime,
                kind="upload",
            )
        )
    return saved


@app.post("/api/sessions/{session_id}/chat", status_code=201)
def chat(session_id: str, payload: dict, user: UserProfile = Depends(require_user)):
    session_state = store.get_session(session_id, user.id)
    if not session_state:
        raise HTTPException(status_code=404, detail="Session not found")

    content = str((payload or {}).get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Please enter a message.")

    runtime_config = store.runtime_config()
    if not runtime_config.api_key:
        raise HTTPException(status_code=400, detail="Please configure OPENAI_API_KEY first.")

    user_message = store.add_message(
        session_id=session_id,
        role="user",
        content=content,
        image_ids=[],
    )

    try:
        latest = store.get_session(session_id, user.id)
        summary = maybe_compress_history(runtime_config, latest["session"], latest["messages"])
        if summary != latest["session"].summary:
            store.update_session(session_id, user_id=user.id, summary=summary, summary_updated_at=now_iso())

        refreshed = store.get_session(session_id, user.id)
        prompt_context = build_prompt_context(refreshed["session"], refreshed["messages"])
        answer = request_chat_response(runtime_config, prompt_context, content)
        assistant_message = store.add_message(
            session_id=session_id,
            role="assistant",
            content=answer,
            image_ids=[],
            meta={"promptContext": prompt_context},
        )

        if refreshed["session"].title == DEFAULT_SESSION_TITLE:
            store.update_session(session_id, user_id=user.id, title=content[:28] or DEFAULT_SESSION_TITLE)

        return {"userMessage": user_message, "assistantMessage": assistant_message}
    except Exception as exc:
        message = str(exc) or "Chat failed"
        assistant_message = store.add_message(
            session_id=session_id,
            role="assistant",
            content=f"回复失败：{message}",
            image_ids=[],
            meta={"error": message},
        )
        raise HTTPException(
            status_code=500,
            detail={"error": message, "userMessage": user_message, "assistantMessage": assistant_message},
        ) from exc


@app.post("/api/sessions/{session_id}/generate", status_code=201)
def generate_image(session_id: str, payload: GeneratePayload, user: UserProfile = Depends(require_user)):
    session_state = store.get_session(session_id, user.id)
    if not session_state:
        raise HTTPException(status_code=404, detail="Session not found")
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Please enter an image prompt.")

    runtime_config = store.runtime_config()
    if not runtime_config.api_key:
        raise HTTPException(status_code=400, detail="Please configure OPENAI_API_KEY first.")

    user_message = store.add_message(
        session_id=session_id,
        role="user",
        content=payload.prompt.strip(),
        image_ids=[*payload.source_image_ids, *payload.uploaded_image_ids],
    )

    try:
        latest = store.get_session(session_id, user.id)
        summary = maybe_compress_history(
            runtime_config,
            latest["session"],
            latest["messages"],
        )
        if summary != latest["session"].summary:
            store.update_session(
                session_id,
                user_id=user.id,
                summary=summary,
                summary_updated_at=now_iso(),
            )

        refreshed = store.get_session(session_id, user.id)
        prompt_context = build_prompt_context(refreshed["session"], refreshed["messages"])
        source_ids = [*payload.source_image_ids, *payload.uploaded_image_ids]
        source_images = store.find_images(source_ids)
        result = request_image(
            runtime_config,
            payload,
            prompt_context,
            source_images,
            store.image_path,
        )
        decoded_images = decode_image_results(result, payload.options.format)
        revised_prompts = [item[3] for item in decoded_images if item[3]]
        assistant_message = store.add_message(
            session_id=session_id,
            role="assistant",
            content="Image generated.",
            image_ids=[],
            meta={
                "promptContext": prompt_context,
                "revisedPrompt": revised_prompts[0] if revised_prompts else None,
                "revisedPrompts": revised_prompts,
                "sourceImageIds": source_ids,
            },
        )
        images = []
        for content, mime_type, ext, _revised_prompt in decoded_images:
            filename = store.save_image_file(content, ext)
            images.append(
                store.add_image(
                    session_id=session_id,
                    message_id=assistant_message.id,
                    filename=filename,
                    mime_type=mime_type,
                    kind="generated",
                    prompt=payload.prompt,
                    options=payload.options,
                )
            )
        assistant_message = store.update_message(assistant_message.id, image_ids=[image.id for image in images])
        current_title = refreshed["session"].title
        if current_title == DEFAULT_SESSION_TITLE:
            store.update_session(session_id, user_id=user.id, title=payload.prompt[:28] or current_title, options=payload.options)
        else:
            store.update_session(session_id, user_id=user.id, options=payload.options)

        return {
            "userMessage": user_message,
            "assistantMessage": assistant_message,
            "image": images[0],
            "images": images,
        }
    except Exception as exc:
        message = str(exc) or "Image generation failed"
        assistant_message = store.add_message(
            session_id=session_id,
            role="assistant",
            content=f"Generation failed: {message}",
            image_ids=[],
            meta={"error": message},
        )
        raise HTTPException(
            status_code=500,
            detail={"error": message, "userMessage": user_message, "assistantMessage": assistant_message},
        ) from exc


@app.post("/api/guest/chat", status_code=201)
def guest_chat(payload: GuestChatPayload):
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Please enter a message.")
    runtime_config = store.runtime_config()
    if not runtime_config.api_key:
        raise HTTPException(status_code=400, detail="Please configure OPENAI_API_KEY first.")

    session = ChatSession(
        id="guest",
        title=DEFAULT_SESSION_TITLE,
        summary=payload.summary,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    prompt_context = build_prompt_context(session, payload.messages)
    answer = request_chat_response(runtime_config, prompt_context, content)
    return {"content": answer, "meta": {"promptContext": prompt_context}}


@app.post("/api/guest/uploads", status_code=201)
async def guest_upload_images(images: list[UploadFile] = File(...)):
    saved = []
    for image in images[:6]:
        content = await image.read()
        mime = image.content_type or "image/png"
        ext = "webp" if "webp" in mime else "jpg" if "jpeg" in mime or "jpg" in mime else "png"
        filename = store.save_image_file(content, ext)
        saved.append(
            ImageAsset(
                id=secrets.token_hex(16),
                session_id="guest",
                filename=filename,
                original_name=image.filename,
                mime_type=mime,
                kind="upload",
                url=f"/assets/{filename}",
                created_at=now_iso(),
            )
        )
    return saved


@app.post("/api/guest/generate", status_code=201)
def guest_generate(payload: GuestGeneratePayload):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Please enter an image prompt.")
    runtime_config = store.runtime_config()
    if not runtime_config.api_key:
        raise HTTPException(status_code=400, detail="Please configure OPENAI_API_KEY first.")

    source_images = [
        ImageAsset(
            id=image.id,
            session_id="guest",
            filename=image.filename,
            original_name=image.original_name,
            mime_type=image.mime_type,
            kind="upload",
            url=f"/assets/{image.filename}",
            created_at=now_iso(),
        )
        for image in payload.source_images
    ]
    prompt_context = build_prompt_context(
        ChatSession(
            id="guest",
            title=DEFAULT_SESSION_TITLE,
            summary=payload.summary,
            created_at=now_iso(),
            updated_at=now_iso(),
        ),
        payload.messages,
    )
    result = request_image(runtime_config, payload, prompt_context, source_images, store.image_path)
    decoded_images = decode_image_results(result, payload.options.format)
    revised_prompts = [item[3] for item in decoded_images if item[3]]
    images = []
    for content, mime_type, ext, _revised_prompt in decoded_images:
        filename = store.save_image_file(content, ext)
        images.append(
            ImageAsset(
                id=secrets.token_hex(16),
                session_id="guest",
                filename=filename,
                mime_type=mime_type,
                kind="generated",
                url=f"/assets/{filename}",
                created_at=now_iso(),
                prompt=payload.prompt,
                options=payload.options,
            )
        )
    return {
        "content": "Image generated.",
        "image": images[0],
        "images": images,
        "meta": {
            "promptContext": prompt_context,
            "revisedPrompt": revised_prompts[0] if revised_prompts else None,
            "revisedPrompts": revised_prompts,
        },
    }


@app.post("/api/sync", status_code=201)
def sync_local_history(payload: SyncPayload, user: UserProfile = Depends(require_user)):
    imported = []
    for detail in payload.sessions:
        if not detail.messages and not detail.images:
            continue
        session = store.create_session(detail.session.title or DEFAULT_SESSION_TITLE, user.id)
        store.update_session(
            session.id,
            user_id=user.id,
            summary=detail.session.summary,
            summary_updated_at=detail.session.summary_updated_at,
            options=detail.session.options,
        )
        image_id_map = {}
        for image in detail.images:
            if image.kind == "upload" and not Path(store.image_path(image.filename)).exists():
                continue
            saved = store.add_image(
                session_id=session.id,
                message_id=None,
                filename=image.filename,
                original_name=image.original_name,
                mime_type=image.mime_type,
                kind=image.kind,
                prompt=image.prompt,
                options=image.options,
            )
            image_id_map[image.id] = saved.id
        for message in detail.messages:
            store.add_message(
                session_id=session.id,
                role=message.role,
                content=message.content,
                image_ids=[image_id_map.get(image_id, image_id) for image_id in message.image_ids],
                meta=message.meta,
            )
        imported.append(session.id)
    return {"ok": True, "imported": len(imported), "sessions": store.list_sessions(user.id)}


def request_chat_response(runtime_config, prompt_context: str, content: str) -> str:
    base_url = (runtime_config.base_url or "https://api.openai.com/v1").rstrip("/")
    headers = {"Authorization": f"Bearer {runtime_config.api_key}"}
    payload = {
        "model": runtime_config.text_model,
        "input": [
            {
                "role": "system",
                "content": (
                    "You are a concise Chinese assistant inside an image creation app. "
                    "Answer normal chat directly. If the user wants image generation, "
                    "explain they should switch to image mode."
                ),
            },
            {
                "role": "user",
                "content": f"Context:\n{prompt_context}\n\nUser message:\n{content}",
            },
        ],
    }
    with httpx.Client(timeout=90) as client:
        response = client.post(f"{base_url}/responses", json=payload, headers=headers)
        response.raise_for_status()
    text = extract_response_text(response.json())
    return text or "我收到了。"


def extract_response_text(data: dict) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"].strip()
    chunks = []
    for item in data.get("output", []):
        for part in item.get("content", []):
            text = part.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "\n".join(chunks).strip()


client_dist = Path("dist/client")
if client_dist.exists():
    app.mount("/", StaticFiles(directory=str(client_dist), html=True), name="client")


@app.get("/{path_name:path}")
def spa_fallback(path_name: str):
    index_file = client_dist / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Frontend is not built. Run npm run client:dev.")
