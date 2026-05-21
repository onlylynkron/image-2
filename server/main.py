from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import load_config
from .history import build_prompt_context, maybe_compress_history
from .models import GeneratePayload, ServerConfigPatch
from .openai_image import decode_image_result, request_image
from .storage import DEFAULT_SESSION_TITLE, create_store, now_iso

config = load_config()
store = create_store(config)
store.init()

app = FastAPI(title="Image2 Studio API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets", StaticFiles(directory=str(Path(config.data_dir) / "images")), name="assets")


@app.get("/api/health")
def health():
    return {"ok": True, "config": store.public_config()}


@app.get("/api/config")
def get_config():
    return store.public_config()


@app.put("/api/config")
def update_config(patch: ServerConfigPatch):
    return store.update_config(patch)


@app.get("/api/sessions")
def list_sessions():
    sessions = store.list_sessions()
    if not sessions:
        store.create_session()
        sessions = store.list_sessions()
    return sessions


@app.post("/api/sessions", status_code=201)
def create_session(payload: dict | None = None):
    return store.create_session((payload or {}).get("title") or DEFAULT_SESSION_TITLE)


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: str, payload: dict):
    session = store.update_session(session_id, **payload)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.post("/api/sessions/{session_id}/uploads", status_code=201)
async def upload_images(session_id: str, images: list[UploadFile] = File(...)):
    if not store.get_session(session_id):
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


@app.post("/api/sessions/{session_id}/generate", status_code=201)
def generate_image(session_id: str, payload: GeneratePayload):
    session_state = store.get_session(session_id)
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
        latest = store.get_session(session_id)
        summary = maybe_compress_history(
            runtime_config,
            latest["session"],
            latest["messages"],
        )
        if summary != latest["session"].summary:
            store.update_session(
                session_id,
                summary=summary,
                summary_updated_at=now_iso(),
            )

        refreshed = store.get_session(session_id)
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
        content, mime_type, ext, revised_prompt = decode_image_result(result, payload.options.format)
        filename = store.save_image_file(content, ext)
        assistant_message = store.add_message(
            session_id=session_id,
            role="assistant",
            content="Image generated.",
            image_ids=[],
            meta={
                "promptContext": prompt_context,
                "revisedPrompt": revised_prompt,
                "sourceImageIds": source_ids,
            },
        )
        image = store.add_image(
            session_id=session_id,
            message_id=assistant_message.id,
            filename=filename,
            mime_type=mime_type,
            kind="generated",
            prompt=payload.prompt,
            options=payload.options,
        )
        assistant_message = store.update_message(assistant_message.id, image_ids=[image.id])
        current_title = refreshed["session"].title
        if current_title == DEFAULT_SESSION_TITLE:
            store.update_session(session_id, title=payload.prompt[:28] or current_title, options=payload.options)
        else:
            store.update_session(session_id, options=payload.options)

        return {
            "userMessage": user_message,
            "assistantMessage": assistant_message,
            "image": image,
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


client_dist = Path("dist/client")
if client_dist.exists():
    app.mount("/", StaticFiles(directory=str(client_dist), html=True), name="client")


@app.get("/{path_name:path}")
def spa_fallback(path_name: str):
    index_file = client_dist / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Frontend is not built. Run npm run client:dev.")
