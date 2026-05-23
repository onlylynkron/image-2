from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Protocol
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .models import (
    ChatMessage,
    ChatSession,
    Database,
    ImageAsset,
    ImageOptions,
    PublicConfig,
    ServerConfig,
    ServerConfigPatch,
    UserProfile,
)

DEFAULT_SESSION_TITLE = "未命名会话"
DEFAULT_USER_NAME = "Local user"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store(Protocol):
    backend: str

    def init(self) -> None: ...
    def image_path(self, filename: str) -> Path: ...
    def runtime_config(self) -> ServerConfig: ...
    def public_config(self) -> PublicConfig: ...
    def update_config(self, patch: ServerConfigPatch) -> PublicConfig: ...
    def create_user(self, username: str, password_hash: str) -> UserProfile: ...
    def upsert_oauth_user(self, username: str, display_name: str) -> UserProfile: ...
    def find_user_by_username(self, username: str) -> UserProfile | None: ...
    def get_user(self, user_id: str) -> UserProfile | None: ...
    def list_sessions(self, user_id: str | None = None) -> list[dict]: ...
    def create_session(self, title: str = DEFAULT_SESSION_TITLE, user_id: str | None = None) -> ChatSession: ...
    def get_session(self, session_id: str, user_id: str | None = None): ...
    def update_session(self, session_id: str, user_id: str | None = None, **patch) -> ChatSession | None: ...
    def add_message(self, session_id: str, role: str, content: str, image_ids=None, meta=None) -> ChatMessage: ...
    def update_message(self, message_id: str, **patch) -> ChatMessage | None: ...
    def add_image(self, **payload) -> ImageAsset: ...
    def find_images(self, ids: list[str]) -> list[ImageAsset]: ...
    def save_image_file(self, content: bytes, ext: str) -> str: ...
    def clear_session_history(self, session_id: str) -> bool: ...
    def delete_session(self, session_id: str) -> bool: ...


def create_store(config: ServerConfig) -> Store:
    if config.database_url:
        return PostgresStore(config)
    return JsonStore(config)


def _default_db() -> Database:
    stamp = now_iso()
    return Database(
        user=UserProfile(
            id=str(uuid4()),
            username="local",
            display_name=DEFAULT_USER_NAME,
            created_at=stamp,
            updated_at=stamp,
        )
    )


class JsonStore:
    backend = "json"

    def __init__(self, config: ServerConfig):
        self.config = config
        self.data_dir = Path(config.data_dir)
        self.images_dir = self.data_dir / "images"
        self.db_path = self.data_dir / "db.json"
        self.config_path = self.data_dir / "server-config.json"
        self._lock = Lock()

    def init(self) -> None:
        self.images_dir.mkdir(parents=True, exist_ok=True)
        if not self.db_path.exists():
            self.write_db(_default_db())

    def image_path(self, filename: str) -> Path:
        return self.images_dir / filename

    def read_db(self) -> Database:
        self.init()
        with self.db_path.open("r", encoding="utf-8") as file:
            return Database.model_validate(json.load(file))

    def write_db(self, db: Database) -> None:
        self.images_dir.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self.db_path.write_text(
                json.dumps(db.model_dump(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def _read_disk_config(self) -> dict:
        if not self.config_path.exists():
            return {}
        return json.loads(self.config_path.read_text(encoding="utf-8"))

    def runtime_config(self) -> ServerConfig:
        disk = self._read_disk_config()
        return self.config.model_copy(
            update={
                **disk,
                "api_key": disk.get("api_key") or self.config.api_key,
                "google_client_id": disk.get("google_client_id") or self.config.google_client_id,
                "data_dir": self.config.data_dir,
                "database_url": self.config.database_url,
            }
        )

    def public_config(self) -> PublicConfig:
        config = self.runtime_config()
        return PublicConfig(
            base_url=config.base_url,
            image_model=config.image_model,
            text_model=config.text_model,
            has_api_key=bool(config.api_key),
            google_auth_enabled=bool(config.google_client_id),
            google_client_id=config.google_client_id,
            storage_backend=self.backend,
        )

    def update_config(self, patch: ServerConfigPatch) -> PublicConfig:
        current = self._read_disk_config()
        incoming = patch.model_dump(exclude_unset=True)
        current.update({key: value for key, value in incoming.items() if value is not None})
        self.config_path.write_text(
            json.dumps(current, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return self.public_config()

    def create_user(self, username: str, password_hash: str) -> UserProfile:
        db = self.read_db()
        stamp = now_iso()
        user = UserProfile(
            id=str(uuid4()),
            username=username,
            display_name=username,
            password_hash=password_hash,
            created_at=stamp,
            updated_at=stamp,
        )
        db.user = user
        self.write_db(db)
        return user

    def upsert_oauth_user(self, username: str, display_name: str) -> UserProfile:
        db = self.read_db()
        existing = db.user if db.user.username == username else None
        stamp = now_iso()
        if existing:
            user = existing.model_copy(update={"display_name": display_name or existing.display_name, "updated_at": stamp})
        else:
            user = UserProfile(
                id=str(uuid4()),
                username=username,
                display_name=display_name or username,
                password_hash=None,
                created_at=stamp,
                updated_at=stamp,
            )
        db.user = user
        self.write_db(db)
        return user

    def find_user_by_username(self, username: str) -> UserProfile | None:
        db = self.read_db()
        return db.user if db.user.username == username else None

    def get_user(self, user_id: str) -> UserProfile | None:
        db = self.read_db()
        return db.user if db.user.id == user_id else None

    def list_sessions(self, user_id: str | None = None) -> list[dict]:
        db = self.read_db()
        sessions = sorted(db.sessions, key=lambda item: item.updated_at, reverse=True)
        if user_id:
            sessions = [session for session in sessions if session.user_id == user_id]
        session_items = [
            {
                **session.model_dump(),
                "message_count": len([m for m in db.messages if m.session_id == session.id]),
                "image_count": len([i for i in db.images if i.session_id == session.id]),
            }
            for session in sessions
        ]
        return [item for item in session_items if item["message_count"] > 0 or item["image_count"] > 0]

    def create_session(self, title: str = DEFAULT_SESSION_TITLE, user_id: str | None = None) -> ChatSession:
        db = self.read_db()
        stamp = now_iso()
        session = ChatSession(
            id=str(uuid4()),
            user_id=user_id,
            title=title,
            created_at=stamp,
            updated_at=stamp,
            options=ImageOptions(),
        )
        db.sessions.insert(0, session)
        self.write_db(db)
        return session

    def get_session(self, session_id: str, user_id: str | None = None):
        db = self.read_db()
        session = next((item for item in db.sessions if item.id == session_id), None)
        if not session:
            return None
        if user_id and session.user_id != user_id:
            return None
        return {
            "session": session,
            "messages": [m for m in db.messages if m.session_id == session_id],
            "images": [i for i in db.images if i.session_id == session_id],
        }

    def update_session(self, session_id: str, user_id: str | None = None, **patch) -> ChatSession | None:
        db = self.read_db()
        session = next((item for item in db.sessions if item.id == session_id), None)
        if not session:
            return None
        if user_id and session.user_id != user_id:
            return None
        updated = session.model_copy(update={**patch, "updated_at": now_iso()})
        db.sessions = [updated if item.id == session_id else item for item in db.sessions]
        self.write_db(db)
        return updated

    def add_message(self, session_id: str, role: str, content: str, image_ids=None, meta=None) -> ChatMessage:
        db = self.read_db()
        message = ChatMessage(
            id=str(uuid4()),
            session_id=session_id,
            role=role,
            content=content,
            image_ids=image_ids or [],
            created_at=now_iso(),
            meta=meta,
        )
        db.messages.append(message)
        for index, session in enumerate(db.sessions):
            if session.id == session_id:
                db.sessions[index] = session.model_copy(update={"updated_at": now_iso()})
        self.write_db(db)
        return message

    def update_message(self, message_id: str, **patch) -> ChatMessage | None:
        db = self.read_db()
        found = None
        updated_messages = []
        for message in db.messages:
            if message.id == message_id:
                message = message.model_copy(update=patch)
                found = message
            updated_messages.append(message)
        db.messages = updated_messages
        self.write_db(db)
        return found

    def add_image(self, **payload) -> ImageAsset:
        db = self.read_db()
        image = ImageAsset(
            **payload,
            id=str(uuid4()),
            created_at=now_iso(),
            url=f"/assets/{payload['filename']}",
        )
        db.images.append(image)
        self.write_db(db)
        return image

    def find_images(self, ids: list[str]) -> list[ImageAsset]:
        db = self.read_db()
        return [image for image in db.images if image.id in ids]

    def save_image_file(self, content: bytes, ext: str) -> str:
        filename = f"{uuid4()}.{ext}"
        self.image_path(filename).write_bytes(content)
        return filename

    def clear_session_history(self, session_id: str) -> bool:
        db = self.read_db()
        session = next((item for item in db.sessions if item.id == session_id), None)
        if not session:
            return False
        filenames = [image.filename for image in db.images if image.session_id == session_id]
        db.messages = [message for message in db.messages if message.session_id != session_id]
        db.images = [image for image in db.images if image.session_id != session_id]
        db.sessions = [
            item.model_copy(
                update={
                    "summary": "",
                    "summary_updated_at": None,
                    "updated_at": now_iso(),
                }
            )
            if item.id == session_id
            else item
            for item in db.sessions
        ]
        self.write_db(db)
        self._delete_local_files(filenames)
        return True

    def delete_session(self, session_id: str) -> bool:
        db = self.read_db()
        if not any(item.id == session_id for item in db.sessions):
            return False
        filenames = [image.filename for image in db.images if image.session_id == session_id]
        db.sessions = [session for session in db.sessions if session.id != session_id]
        db.messages = [message for message in db.messages if message.session_id != session_id]
        db.images = [image for image in db.images if image.session_id != session_id]
        self.write_db(db)
        self._delete_local_files(filenames)
        return True

    def _delete_local_files(self, filenames: list[str]) -> None:
        for filename in filenames:
            try:
                self.image_path(filename).unlink()
            except FileNotFoundError:
                pass


class PostgresStore:
    backend = "postgres"

    def __init__(self, config: ServerConfig):
        self.config = config
        self.data_dir = Path(config.data_dir)
        self.images_dir = self.data_dir / "images"

    def connect(self):
        return psycopg.connect(self.config.database_url, row_factory=dict_row)

    def init(self) -> None:
        self.images_dir.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS app_user (
                        id text PRIMARY KEY,
                        username text UNIQUE,
                        display_name text NOT NULL,
                        password_hash text,
                        created_at text NOT NULL,
                        updated_at text NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS server_config (
                        key text PRIMARY KEY,
                        value text NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS chat_sessions (
                        id text PRIMARY KEY,
                        user_id text REFERENCES app_user(id) ON DELETE CASCADE,
                        title text NOT NULL,
                        summary text NOT NULL DEFAULT '',
                        summary_updated_at text,
                        created_at text NOT NULL,
                        updated_at text NOT NULL,
                        options jsonb NOT NULL DEFAULT '{}'::jsonb
                    );
                    CREATE TABLE IF NOT EXISTS chat_messages (
                        id text PRIMARY KEY,
                        session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                        role text NOT NULL,
                        content text NOT NULL,
                        image_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
                        created_at text NOT NULL,
                        meta jsonb
                    );
                    CREATE TABLE IF NOT EXISTS image_assets (
                        id text PRIMARY KEY,
                        session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                        message_id text,
                        filename text NOT NULL UNIQUE,
                        original_name text,
                        mime_type text NOT NULL,
                        kind text NOT NULL,
                        url text NOT NULL,
                        created_at text NOT NULL,
                        prompt text,
                        options jsonb
                    );
                    CREATE TABLE IF NOT EXISTS image_blobs (
                        filename text PRIMARY KEY,
                        content bytea NOT NULL,
                        created_at text NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
                    CREATE INDEX IF NOT EXISTS idx_image_assets_session_id ON image_assets(session_id);
                    """
                )
                cur.execute("ALTER TABLE app_user ADD COLUMN IF NOT EXISTS username text")
                cur.execute("ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_hash text")
                cur.execute("ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS user_id text")
                cur.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_username ON app_user (username) WHERE username IS NOT NULL"
                )
                cur.execute("SELECT id FROM app_user LIMIT 1")
                if not cur.fetchone():
                    stamp = now_iso()
                    cur.execute(
                        """
                        INSERT INTO app_user (id, username, display_name, password_hash, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (str(uuid4()), "local", DEFAULT_USER_NAME, None, stamp, stamp),
                    )

    def image_path(self, filename: str) -> Path:
        return self.images_dir / filename

    def runtime_config(self) -> ServerConfig:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT key, value FROM server_config")
                disk = {row["key"]: row["value"] for row in cur.fetchall()}
        return self.config.model_copy(
            update={
                **disk,
                "api_key": disk.get("api_key") or self.config.api_key,
                "google_client_id": disk.get("google_client_id") or self.config.google_client_id,
                "data_dir": self.config.data_dir,
                "database_url": self.config.database_url,
            }
        )

    def public_config(self) -> PublicConfig:
        config = self.runtime_config()
        return PublicConfig(
            base_url=config.base_url,
            image_model=config.image_model,
            text_model=config.text_model,
            has_api_key=bool(config.api_key),
            google_auth_enabled=bool(config.google_client_id),
            google_client_id=config.google_client_id,
            storage_backend=self.backend,
        )

    def update_config(self, patch: ServerConfigPatch) -> PublicConfig:
        incoming = patch.model_dump(exclude_unset=True)
        with self.connect() as conn:
            with conn.cursor() as cur:
                for key, value in incoming.items():
                    if value is None:
                        continue
                    cur.execute(
                        """
                        INSERT INTO server_config (key, value) VALUES (%s, %s)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                        """,
                        (key, value),
                    )
        return self.public_config()

    def create_user(self, username: str, password_hash: str) -> UserProfile:
        stamp = now_iso()
        user = UserProfile(
            id=str(uuid4()),
            username=username,
            display_name=username,
            password_hash=password_hash,
            created_at=stamp,
            updated_at=stamp,
        )
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO app_user (id, username, display_name, password_hash, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (user.id, user.username, user.display_name, user.password_hash, user.created_at, user.updated_at),
                )
        return user

    def upsert_oauth_user(self, username: str, display_name: str) -> UserProfile:
        existing = self.find_user_by_username(username)
        stamp = now_iso()
        if existing:
            user = existing.model_copy(update={"display_name": display_name or existing.display_name, "updated_at": stamp})
            with self.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE app_user SET display_name = %s, updated_at = %s WHERE id = %s",
                        (user.display_name, user.updated_at, user.id),
                    )
            return user

        user = UserProfile(
            id=str(uuid4()),
            username=username,
            display_name=display_name or username,
            password_hash=None,
            created_at=stamp,
            updated_at=stamp,
        )
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO app_user (id, username, display_name, password_hash, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (user.id, user.username, user.display_name, user.password_hash, user.created_at, user.updated_at),
                )
        return user

    def find_user_by_username(self, username: str) -> UserProfile | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM app_user WHERE username = %s", (username,))
                row = cur.fetchone()
        return self._user_row(row) if row else None

    def get_user(self, user_id: str) -> UserProfile | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM app_user WHERE id = %s", (user_id,))
                row = cur.fetchone()
        return self._user_row(row) if row else None

    def list_sessions(self, user_id: str | None = None) -> list[dict]:
        with self.connect() as conn:
            with conn.cursor() as cur:
                where_clause = "WHERE s.user_id = %s" if user_id else ""
                params = (user_id,) if user_id else ()
                cur.execute(
                    f"""
                    SELECT s.*,
                        COUNT(DISTINCT m.id) AS message_count,
                        COUNT(DISTINCT i.id) AS image_count
                    FROM chat_sessions s
                    LEFT JOIN chat_messages m ON m.session_id = s.id
                    LEFT JOIN image_assets i ON i.session_id = s.id
                    {where_clause}
                    GROUP BY s.id
                    HAVING COUNT(DISTINCT m.id) > 0 OR COUNT(DISTINCT i.id) > 0
                    ORDER BY s.updated_at DESC
                    """,
                    params,
                )
                return [self._session_row(row) for row in cur.fetchall()]

    def create_session(self, title: str = DEFAULT_SESSION_TITLE, user_id: str | None = None) -> ChatSession:
        stamp = now_iso()
        session = ChatSession(
            id=str(uuid4()),
            user_id=user_id,
            title=title,
            created_at=stamp,
            updated_at=stamp,
            options=ImageOptions(),
        )
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_sessions
                        (id, user_id, title, summary, summary_updated_at, created_at, updated_at, options)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        session.id,
                        session.user_id,
                        session.title,
                        session.summary,
                        session.summary_updated_at,
                        session.created_at,
                        session.updated_at,
                        Jsonb(session.options.model_dump()),
                    ),
                )
        return session

    def get_session(self, session_id: str, user_id: str | None = None):
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM chat_sessions WHERE id = %s AND (%s IS NULL OR user_id = %s)",
                    (session_id, user_id, user_id),
                )
                session_row = cur.fetchone()
                if not session_row:
                    return None
                cur.execute("SELECT * FROM chat_messages WHERE session_id = %s ORDER BY created_at", (session_id,))
                messages = [self._message_row(row) for row in cur.fetchall()]
                cur.execute("SELECT * FROM image_assets WHERE session_id = %s ORDER BY created_at", (session_id,))
                images = [self._image_row(row) for row in cur.fetchall()]
        return {
            "session": self._session_model(session_row),
            "messages": messages,
            "images": images,
        }

    def update_session(self, session_id: str, user_id: str | None = None, **patch) -> ChatSession | None:
        current = self.get_session(session_id, user_id)
        if not current:
            return None
        session = current["session"].model_copy(update={**patch, "updated_at": now_iso()})
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE chat_sessions
                    SET title = %s, summary = %s, summary_updated_at = %s, updated_at = %s, options = %s
                    WHERE id = %s
                    """,
                    (
                        session.title,
                        session.summary,
                        session.summary_updated_at,
                        session.updated_at,
                        Jsonb(session.options.model_dump()),
                        session.id,
                    ),
                )
        return session

    def add_message(self, session_id: str, role: str, content: str, image_ids=None, meta=None) -> ChatMessage:
        message = ChatMessage(
            id=str(uuid4()),
            session_id=session_id,
            role=role,
            content=content,
            image_ids=image_ids or [],
            created_at=now_iso(),
            meta=meta,
        )
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_messages
                        (id, session_id, role, content, image_ids, created_at, meta)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        message.id,
                        message.session_id,
                        message.role,
                        message.content,
                        Jsonb(message.image_ids),
                        message.created_at,
                        Jsonb(message.meta) if message.meta is not None else None,
                    ),
                )
                cur.execute("UPDATE chat_sessions SET updated_at = %s WHERE id = %s", (now_iso(), session_id))
        return message

    def update_message(self, message_id: str, **patch) -> ChatMessage | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM chat_messages WHERE id = %s", (message_id,))
                row = cur.fetchone()
                if not row:
                    return None
                message = self._message_row(row).model_copy(update=patch)
                cur.execute(
                    """
                    UPDATE chat_messages
                    SET role = %s, content = %s, image_ids = %s, meta = %s
                    WHERE id = %s
                    """,
                    (
                        message.role,
                        message.content,
                        Jsonb(message.image_ids),
                        Jsonb(message.meta) if message.meta is not None else None,
                        message.id,
                    ),
                )
        return message

    def add_image(self, **payload) -> ImageAsset:
        image = ImageAsset(
            **payload,
            id=str(uuid4()),
            created_at=now_iso(),
            url=f"/assets/{payload['filename']}",
        )
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO image_assets
                        (id, session_id, message_id, filename, original_name, mime_type, kind, url,
                         created_at, prompt, options)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        image.id,
                        image.session_id,
                        image.message_id,
                        image.filename,
                        image.original_name,
                        image.mime_type,
                        image.kind,
                        image.url,
                        image.created_at,
                        image.prompt,
                        Jsonb(image.options.model_dump()) if image.options else None,
                    ),
                )
        return image

    def find_images(self, ids: list[str]) -> list[ImageAsset]:
        if not ids:
            return []
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM image_assets WHERE id = ANY(%s)", (ids,))
                return [self._image_row(row) for row in cur.fetchall()]

    def save_image_file(self, content: bytes, ext: str) -> str:
        filename = f"{uuid4()}.{ext}"
        self.image_path(filename).write_bytes(content)
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO image_blobs (filename, content, created_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (filename) DO UPDATE
                    SET content = EXCLUDED.content, created_at = EXCLUDED.created_at
                    """,
                    (filename, content, now_iso()),
                )
        return filename

    def clear_session_history(self, session_id: str) -> bool:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM chat_sessions WHERE id = %s", (session_id,))
                if not cur.fetchone():
                    return False
                cur.execute("SELECT filename FROM image_assets WHERE session_id = %s", (session_id,))
                filenames = [row["filename"] for row in cur.fetchall()]
                cur.execute("DELETE FROM chat_messages WHERE session_id = %s", (session_id,))
                cur.execute("DELETE FROM image_assets WHERE session_id = %s", (session_id,))
                if filenames:
                    cur.execute("DELETE FROM image_blobs WHERE filename = ANY(%s)", (filenames,))
                cur.execute(
                    """
                    UPDATE chat_sessions
                    SET summary = '', summary_updated_at = NULL, updated_at = %s
                    WHERE id = %s
                    """,
                    (now_iso(), session_id),
                )
        self._delete_local_files(filenames)
        return True

    def delete_session(self, session_id: str) -> bool:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT filename FROM image_assets WHERE session_id = %s", (session_id,))
                filenames = [row["filename"] for row in cur.fetchall()]
                cur.execute("DELETE FROM image_blobs WHERE filename = ANY(%s)", (filenames,))
                cur.execute("DELETE FROM chat_sessions WHERE id = %s", (session_id,))
                deleted = cur.rowcount > 0
        if deleted:
            self._delete_local_files(filenames)
        return deleted

    def _delete_local_files(self, filenames: list[str]) -> None:
        for filename in filenames:
            try:
                self.image_path(filename).unlink()
            except FileNotFoundError:
                pass

    def _session_model(self, row: dict) -> ChatSession:
        return ChatSession(
            id=row["id"],
            user_id=row.get("user_id"),
            title=row["title"],
            summary=row["summary"] or "",
            summary_updated_at=row["summary_updated_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            options=ImageOptions.model_validate(row["options"] or {}),
        )

    def _session_row(self, row: dict) -> dict:
        return {
            **self._session_model(row).model_dump(),
            "message_count": int(row["message_count"]),
            "image_count": int(row["image_count"]),
        }

    def _message_row(self, row: dict) -> ChatMessage:
        return ChatMessage(
            id=row["id"],
            session_id=row["session_id"],
            role=row["role"],
            content=row["content"],
            image_ids=row["image_ids"] or [],
            created_at=row["created_at"],
            meta=row["meta"],
        )

    def _image_row(self, row: dict) -> ImageAsset:
        return ImageAsset(
            id=row["id"],
            session_id=row["session_id"],
            message_id=row["message_id"],
            filename=row["filename"],
            original_name=row["original_name"],
            mime_type=row["mime_type"],
            kind=row["kind"],
            url=row["url"],
            created_at=row["created_at"],
            prompt=row["prompt"],
            options=ImageOptions.model_validate(row["options"]) if row["options"] else None,
        )

    def _user_row(self, row: dict) -> UserProfile:
        return UserProfile(
            id=row["id"],
            username=row.get("username") or "",
            display_name=row["display_name"],
            password_hash=row.get("password_hash"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
