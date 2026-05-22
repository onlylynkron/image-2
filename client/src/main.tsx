import React from "react";
import { createRoot } from "react-dom/client";
import {
  Download,
  LogOut,
  MessageSquareX,
  Menu,
  MessageSquarePlus,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import "./styles.css";

type ImageQuality = "auto" | "low" | "medium" | "high";
type ImageSize = "auto" | "1024x1024" | "1536x1024" | "1024x1536";
type ImageFormat = "png" | "jpeg" | "webp";

interface ImageOptions {
  quality: ImageQuality;
  size: ImageSize;
  format: ImageFormat;
  compression: number;
}

interface SessionItem {
  id: string;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
  options: ImageOptions;
  message_count: number;
  image_count: number;
}

interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  image_ids: string[];
  created_at: string;
  meta?: Record<string, unknown>;
}

interface ImageAsset {
  id: string;
  session_id: string;
  message_id?: string;
  filename: string;
  original_name?: string;
  mime_type: string;
  kind: "upload" | "generated";
  url: string;
  created_at: string;
  prompt?: string;
  options?: ImageOptions;
}

interface AuthUser {
  id: string;
  username: string;
  display_name: string;
}

interface AuthState {
  token: string;
  user: AuthUser;
}

interface LocalSnapshot {
  sessions: SessionItem[];
  details: Record<string, { session: SessionItem; messages: ChatMessage[]; images: ImageAsset[] }>;
}

const defaultOptions: ImageOptions = {
  quality: "auto",
  size: "1024x1024",
  format: "png",
  compression: 85
};

const LOCAL_HISTORY_KEY = "image2.localHistory.v1";
const AUTH_KEY = "image2.auth.v1";

const api = {
  async json<T>(url: string, init?: RequestInit, token?: string): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers:
        init?.body instanceof FormData
          ? { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) }
          : {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(init?.headers || {})
            }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.detail?.error || payload?.detail || payload?.error || "请求失败";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return payload as T;
  }
};

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLocalHistory(): LocalSnapshot {
  try {
    const saved = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (saved) return JSON.parse(saved) as LocalSnapshot;
  } catch {
    // Ignore broken local snapshots.
  }
  return { sessions: [], details: {} };
}

function writeLocalHistory(snapshot: LocalSnapshot) {
  localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(snapshot));
}

function readAuth(): AuthState | null {
  try {
    const saved = localStorage.getItem(AUTH_KEY);
    return saved ? (JSON.parse(saved) as AuthState) : null;
  } catch {
    return null;
  }
}

function writeAuth(auth: AuthState | null) {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}

const chatIntentRules = [
  /(提示词|prompt|文案|说明|解释|分析|怎么|如何|为什么|教程|步骤|建议|帮我写|优化).*?(图|图片|生图|画面|海报|logo|设计图)/i,
  /(介绍|讲讲|说说|聊聊|解释|说明|分析).*?(图片生成|生图|生成流程|设计图|图片|图像)/i,
  /(流程|原理|区别|教程|步骤|方法|建议|规范|文档|说明).*?(图片生成|生图|生成图片|图像生成)/i,
  /(切换|进入).*(生图|图片|image).*模式/i,
  /(能不能|可以吗|是否).*(生成|画|做).*(图|图片)/i
];

const imageIntentRules = [
  /(生成|生图|出图|画|绘制|渲染|制作|做|设计|创建|生成一张|生成一个).*?(图|图片|图像|照片|海报|封面|logo|头像|壁纸|产品图|展示图|效果图|设计图|渲染图)/i,
  /(图|图片|图像|照片|海报|封面|logo|头像|壁纸|产品图|展示图|效果图|设计图|渲染图).*?(生成|生图|出图|画|绘制|渲染|制作|做|设计|创建)/i,
  /(多视角|三视图|正面|背面|侧面|俯视|细节图|爆炸图|产品展示|产品海报|商品图|主图|场景图)/i,
  /(修改|编辑|重绘|改成|变成|换背景|去背景|抠图|修图|放大).*?(图|图片|照片|这张|上一张)/i,
  /(参考图|用这张|基于这张|上一张图|这张图)/i,
  /\b(generate|create|draw|make|edit|redraw|render)\b.*\b(image|picture|photo|poster|logo|avatar|product)\b/i
];

function isImageRequest(content: string, selectedImageCount: number) {
  if (selectedImageCount > 0) return true;
  if (chatIntentRules.some((rule) => rule.test(content))) return false;
  return imageIntentRules.some((rule) => rule.test(content));
}

function App() {
  const [auth, setAuth] = React.useState<AuthState | null>(() => readAuth());
  const [authOpen, setAuthOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<"login" | "register">("login");
  const [authForm, setAuthForm] = React.useState({ username: "", password: "" });
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [activeId, setActiveId] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [images, setImages] = React.useState<ImageAsset[]>([]);
  const [prompt, setPrompt] = React.useState("");
  const [options, setOptions] = React.useState<ImageOptions>(defaultOptions);
  const [selectedImages, setSelectedImages] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [busyBySession, setBusyBySession] = React.useState<Record<string, "chat" | "image">>({});
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [previewImage, setPreviewImage] = React.useState<ImageAsset | null>(null);
  const [error, setError] = React.useState("");
  const [authError, setAuthError] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const skipNextLoadRef = React.useRef("");
  const activeIdRef = React.useRef("");

  const isLoggedIn = Boolean(auth?.token);
  const activeSession = sessions.find((session) => session.id === activeId);
  const imageById = React.useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images]
  );
  const hasMessages = messages.length > 0;
  const currentBusyType = activeId ? busyBySession[activeId] : undefined;
  const isCurrentSessionBusy = Boolean(currentBusyType);
  const isCurrentSessionGenerating = currentBusyType === "image";

  React.useEffect(() => {
    void bootstrap();
  }, [auth?.token]);

  React.useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  React.useEffect(() => {
    if (!activeId) return;
    if (skipNextLoadRef.current === activeId) {
      skipNextLoadRef.current = "";
      return;
    }
    void loadSession(activeId);
  }, [activeId]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isCurrentSessionGenerating]);

  async function bootstrap() {
    if (!auth?.token) {
      const snapshot = readLocalHistory();
      setSessions(snapshot.sessions);
      setActiveId(snapshot.sessions[0]?.id || "");
      if (!snapshot.sessions[0]) {
        setMessages([]);
        setImages([]);
      }
      return;
    }
    const sessionList = await api.json<SessionItem[]>("/api/sessions", undefined, auth.token);
    setSessions(sessionList);
    setActiveId(sessionList[0]?.id || "");
  }

  async function loadSession(id: string) {
    if (!auth?.token) {
      const detail = readLocalHistory().details[id];
      if (!detail) return;
      setMessages(detail.messages);
      setImages(detail.images);
      setOptions(detail.session.options || defaultOptions);
      setSelectedImages([]);
      return;
    }
    const detail = await api.json<{
      session: SessionItem;
      messages: ChatMessage[];
      images: ImageAsset[];
    }>(`/api/sessions/${id}`, undefined, auth.token);
    setMessages(detail.messages);
    setImages(detail.images);
    setOptions(detail.session.options || defaultOptions);
    setSelectedImages([]);
  }

  async function ensureSession() {
    if (activeId) return activeId;
    if (!auth?.token) {
      const stamp = nowIso();
      const session: SessionItem = {
        id: createId(),
        title: "未命名会话",
        summary: "",
        created_at: stamp,
        updated_at: stamp,
        options,
        message_count: 0,
        image_count: 0
      };
      skipNextLoadRef.current = session.id;
      activeIdRef.current = session.id;
      setActiveId(session.id);
      return session.id;
    }
    const session = await api.json<SessionItem>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "未命名会话" })
    }, auth.token);
    skipNextLoadRef.current = session.id;
    activeIdRef.current = session.id;
    setActiveId(session.id);
    return session.id;
  }

  function createSession() {
    activeIdRef.current = "";
    setActiveId("");
    setMessages([]);
    setImages([]);
    setSelectedImages([]);
    setPrompt("");
    setError("");
    setOptions(defaultOptions);
    setSidebarOpen(false);
  }

  function markSessionBusy(sessionId: string, type: "chat" | "image") {
    setBusyBySession((current) => ({ ...current, [sessionId]: type }));
  }

  function clearSessionBusy(sessionId: string) {
    setBusyBySession((current) => {
      if (!current[sessionId]) return current;
      const { [sessionId]: _removed, ...rest } = current;
      return rest;
    });
  }

  async function refreshSessions() {
    if (!auth?.token) {
      setSessions(readLocalHistory().sessions);
      return;
    }
    setSessions(await api.json<SessionItem[]>("/api/sessions", undefined, auth.token));
  }

  function saveLocalDetail(
    sessionId: string,
    nextMessages: ChatMessage[],
    nextImages: ImageAsset[],
    nextOptions = options
  ) {
    const snapshot = readLocalHistory();
    const previous = snapshot.details[sessionId]?.session;
    const stamp = nowIso();
    const title =
      previous?.title && previous.title !== "未命名会话"
        ? previous.title
        : nextMessages.find((message) => message.role === "user")?.content.slice(0, 28) || "未命名会话";
    const session: SessionItem = {
      id: sessionId,
      title,
      summary: previous?.summary || "",
      created_at: previous?.created_at || stamp,
      updated_at: stamp,
      options: nextOptions,
      message_count: nextMessages.length,
      image_count: nextImages.length
    };
    const sessionsWithoutCurrent = snapshot.sessions.filter((item) => item.id !== sessionId);
    const nextSnapshot: LocalSnapshot = {
      sessions: nextMessages.length || nextImages.length ? [session, ...sessionsWithoutCurrent] : sessionsWithoutCurrent,
      details: {
        ...snapshot.details,
        [sessionId]: { session, messages: nextMessages, images: nextImages }
      }
    };
    writeLocalHistory(nextSnapshot);
    setSessions(nextSnapshot.sessions);
  }

  function replaceMessage(messageId: string, replacement: ChatMessage) {
    setMessages((items) => items.map((item) => (item.id === messageId ? replacement : item)));
  }

  async function submitAuth() {
    setAuthError("");
    try {
      const result = await api.json<AuthState>(`/api/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify(authForm)
      });
      writeAuth(result);
      setAuth(result);
      setAuthOpen(false);
      setAuthForm({ username: "", password: "" });
      await syncLocalHistory(result.token);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "登录失败");
    }
  }

  function logout() {
    writeAuth(null);
    setAuth(null);
    createSession();
  }

  async function syncLocalHistory(token = auth?.token || "") {
    const snapshot = readLocalHistory();
    if (!token || !snapshot.sessions.length) return;
    const payload = {
      sessions: snapshot.sessions
        .map((session) => snapshot.details[session.id])
        .filter(Boolean)
        .map((detail) => ({
          session: detail.session,
          messages: detail.messages,
          images: detail.images
        }))
    };
    const result = await api.json<{ sessions: SessionItem[] }>("/api/sync", {
      method: "POST",
      body: JSON.stringify(payload)
    }, token);
    localStorage.removeItem(LOCAL_HISTORY_KEY);
    setSessions(result.sessions);
    setActiveId(result.sessions[0]?.id || "");
  }

  async function deleteSession(sessionId: string, title: string) {
    if (!window.confirm(`删除会话“${title}”？此操作会删除该会话的历史消息和图片。`)) {
      return;
    }
    setError("");
    try {
      if (!auth?.token) {
        const snapshot = readLocalHistory();
        const nextSessions = snapshot.sessions.filter((item) => item.id !== sessionId);
        const nextDetails = { ...snapshot.details };
        delete nextDetails[sessionId];
        writeLocalHistory({ sessions: nextSessions, details: nextDetails });
        setSessions(nextSessions);
        const nextId = sessionId === activeId ? nextSessions[0]?.id || "" : activeId;
        setActiveId(nextId);
        if (!nextId) {
          setMessages([]);
          setImages([]);
          setSelectedImages([]);
        }
        return;
      }
      const result = await api.json<{ sessions: SessionItem[] }>(`/api/sessions/${sessionId}`, {
        method: "DELETE"
      }, auth.token);
      setSessions(result.sessions);
      const nextId = sessionId === activeId ? result.sessions[0]?.id || "" : activeId;
      setActiveId(nextId);
      if (!nextId) {
        setMessages([]);
        setImages([]);
        setSelectedImages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除会话失败");
    }
  }

  async function clearHistory() {
    if (!activeId) return;
    if (!window.confirm("删除当前会话的全部历史消息和图片？会话本身会保留。")) {
      return;
    }
    setError("");
    try {
      if (!auth?.token) {
        saveLocalDetail(activeId, [], []);
        const snapshot = readLocalHistory();
        const nextSessions = snapshot.sessions.filter((item) => item.id !== activeId);
        const nextDetails = { ...snapshot.details };
        delete nextDetails[activeId];
        writeLocalHistory({ sessions: nextSessions, details: nextDetails });
      } else {
        await api.json(`/api/sessions/${activeId}/history`, { method: "DELETE" }, auth.token);
      }
      setMessages([]);
      setImages([]);
      setSelectedImages([]);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除历史失败");
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const sessionId = await ensureSession();
      const form = new FormData();
      Array.from(files).slice(0, 6).forEach((file) => form.append("images", file));
      const uploaded = await api.json<ImageAsset[]>(
        auth?.token ? `/api/sessions/${sessionId}/uploads` : "/api/guest/uploads",
        {
          method: "POST",
          body: form
        },
        auth?.token
      );
      const nextImages = [...images, ...uploaded.map((image) => ({ ...image, session_id: sessionId }))];
      setImages(nextImages);
      setSelectedImages((ids) => [...new Set([...ids, ...uploaded.map((item) => item.id)])]);
      if (!auth?.token) saveLocalDetail(sessionId, messages, nextImages);
      else await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function sendMessage() {
    if (!prompt.trim() || isCurrentSessionBusy) return;
    if (isImageRequest(prompt.trim(), selectedImages.length)) {
      await generateImage();
      return;
    }
    setError("");
    const nextPrompt = prompt.trim();
    setPrompt("");
    let optimisticMessages = messages;
    let pendingId = "";
    let sessionId = activeId;
    try {
      sessionId = await ensureSession();
      const userMessage: ChatMessage = {
        id: createId(),
        session_id: sessionId,
        role: "user",
        content: nextPrompt,
        image_ids: [],
        created_at: nowIso()
      };
      const pendingMessage: ChatMessage = {
        id: createId(),
        session_id: sessionId,
        role: "assistant",
        content: "",
        image_ids: [],
        created_at: nowIso(),
        meta: { pending: true }
      };
      pendingId = pendingMessage.id;
      optimisticMessages = [...messages, userMessage, pendingMessage];
      setMessages(optimisticMessages);
      markSessionBusy(sessionId, "chat");
      if (!auth?.token) {
        const result = await api.json<{ content: string; meta?: Record<string, unknown> }>("/api/guest/chat", {
          method: "POST",
          body: JSON.stringify({ content: nextPrompt, messages: optimisticMessages.filter((message) => !message.meta?.pending) })
        });
        const assistantMessage: ChatMessage = {
          id: pendingId,
          session_id: sessionId,
          role: "assistant",
          content: result.content,
          image_ids: [],
          created_at: nowIso(),
          meta: result.meta
        };
        const nextMessages = optimisticMessages.map((message) => (message.id === pendingId ? assistantMessage : message));
        if (activeIdRef.current === sessionId) setMessages(nextMessages);
        saveLocalDetail(sessionId, nextMessages, images);
        return;
      }
      const result = await api.json<{
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
      }>(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        body: JSON.stringify({ content: nextPrompt })
      }, auth.token);
      if (activeIdRef.current === sessionId) replaceMessage(pendingId, result.assistantMessage);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "回复失败");
      if (pendingId) {
        const failedMessage: ChatMessage = {
          id: pendingId,
          session_id: sessionId,
          role: "assistant",
          content: err instanceof Error ? `回复失败：${err.message}` : "回复失败",
          image_ids: [],
          created_at: nowIso(),
          meta: { error: true }
        };
        if (activeIdRef.current === sessionId) replaceMessage(pendingId, failedMessage);
        if (!auth?.token && sessionId) {
          saveLocalDetail(
            sessionId,
            optimisticMessages.map((message) => (message.id === pendingId ? failedMessage : message)),
            images
          );
        }
      } else if (activeId) {
        await loadSession(activeId);
      }
    } finally {
      clearSessionBusy(sessionId);
    }
  }

  async function generateImage() {
    if (!prompt.trim() || isCurrentSessionBusy) return;
    setError("");
    const nextPrompt = prompt.trim();
    setPrompt("");
    let optimisticMessages = messages;
    let sessionId = activeId;
    try {
      sessionId = await ensureSession();
      const sourceImages = images.filter((image) => selectedImages.includes(image.id));
      const userMessage: ChatMessage = {
        id: createId(),
        session_id: sessionId,
        role: "user",
        content: nextPrompt,
        image_ids: selectedImages,
        created_at: nowIso()
      };
      optimisticMessages = [...messages, userMessage];
      setMessages(optimisticMessages);
      markSessionBusy(sessionId, "image");
      if (!auth?.token) {
        const result = await api.json<{
          content: string;
          image: ImageAsset;
          meta?: Record<string, unknown>;
        }>("/api/guest/generate", {
          method: "POST",
          body: JSON.stringify({
            prompt: nextPrompt,
            options,
            source_images: sourceImages.map((image) => ({
              id: image.id,
              filename: image.filename,
              original_name: image.original_name,
              mime_type: image.mime_type
            }))
          })
        });
        const image = { ...result.image, id: createId(), session_id: sessionId };
        const assistantMessage: ChatMessage = {
          id: createId(),
          session_id: sessionId,
          role: "assistant",
          content: result.content,
          image_ids: [image.id],
          created_at: nowIso(),
          meta: result.meta
        };
        const nextMessages = [...optimisticMessages, assistantMessage];
        const nextImages = [...images, image];
        if (activeIdRef.current === sessionId) {
          setMessages(nextMessages);
          setImages(nextImages);
          setSelectedImages([image.id]);
        }
        saveLocalDetail(sessionId, nextMessages, nextImages, options);
        return;
      }
      const result = await api.json<{
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
        image: ImageAsset;
      }>(`/api/sessions/${sessionId}/generate`, {
        method: "POST",
        body: JSON.stringify({
          prompt: nextPrompt,
          options,
          source_image_ids: selectedImages
        })
      }, auth.token);
      if (activeIdRef.current === sessionId) {
        setMessages((items) => [...items, result.assistantMessage]);
        setImages((items) => [...items, result.image]);
        setSelectedImages([result.image.id]);
      }
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
      const failedMessage: ChatMessage = {
        id: createId(),
        session_id: sessionId,
        role: "assistant",
        content: err instanceof Error ? `生成失败：${err.message}` : "生成失败",
        image_ids: [],
        created_at: nowIso(),
        meta: { error: true }
      };
      if (activeIdRef.current === sessionId) setMessages([...optimisticMessages, failedMessage]);
      if (!auth?.token && sessionId) saveLocalDetail(sessionId, [...optimisticMessages, failedMessage], images, options);
    } finally {
      clearSessionBusy(sessionId);
    }
  }

  function toggleImage(id: string) {
    setSelectedImages((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  }

  function openPreview(image: ImageAsset) {
    setPreviewImage(image);
  }

  function closePreview() {
    setPreviewImage(null);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <button className="brand-button" onClick={() => setSidebarOpen(false)}>
            <Sparkles size={19} />
            <span>Image2 Studio</span>
          </button>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} title="关闭">
            <X size={18} />
          </button>
        </div>
        <button className="new-chat" onClick={createSession}>
          <MessageSquarePlus size={18} />
          新建会话
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`session-row ${session.id === activeId ? "active" : ""}`}
            >
              <button
                className="session-item"
                onClick={() => {
                  setActiveId(session.id);
                  setSidebarOpen(false);
                }}
              >
                <span>{session.title}</span>
                <small>{session.message_count} 条消息 · {session.image_count} 张图</small>
              </button>
              <button
                className="session-delete"
                onClick={() => void deleteSession(session.id, session.title)}
                title="删除会话"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="auth-card">
          {isLoggedIn ? (
            <>
              <div className="auth-user">
                <strong>{auth?.user.display_name || auth?.user.username}</strong>
                <span>账号历史已同步</span>
              </div>
              <button className="auth-secondary" onClick={() => void syncLocalHistory()}>
                同步本地历史
              </button>
              <button className="auth-secondary" onClick={logout}>
                <LogOut size={15} />
                退出登录
              </button>
            </>
          ) : (
            <>
              <div className="auth-user">
                <strong>游客模式</strong>
                <span>历史保存在本地浏览器</span>
              </div>
              <button className="auth-primary" onClick={() => setAuthOpen(true)}>
                登录 / 注册
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button" onClick={() => setSidebarOpen(true)} title="会话">
            <Menu size={20} />
          </button>
          <button
            className="icon-button clear-button"
            onClick={() => void clearHistory()}
            disabled={!activeId || (!messages.length && !images.length)}
            title="删除历史对话"
          >
            <MessageSquareX size={20} />
          </button>
          <div className="topbar-title">
            <strong>{activeSession?.title || "未命名会话"}</strong>
            <span>独立上下文 · 本地历史</span>
          </div>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="生成参数">
            <Settings size={20} />
          </button>
        </header>

        <section className="conversation">
          {!hasMessages && (
            <div className="home-state">
              <div className="home-brand">
                <Sparkles size={18} />
                <span>Image2 Studio</span>
              </div>
              <div className="home-copy">
                <h1>把想法变成图像</h1>
                <p>描述画面、上传参考图，或继续编辑上一张作品。</p>
              </div>
              {error && <div className="error-line home-error">{error}</div>}
              <div className="home-prompt-card">
                <PromptBox
                  prompt={prompt}
                  setPrompt={setPrompt}
                  sendMessage={sendMessage}
                  uploadFiles={uploadFiles}
                  uploading={uploading}
                  busy={isCurrentSessionBusy}
                  variant="home"
                />
                <div className="home-hint">
                  <span>支持生成与参考图编辑</span>
                  <span>历史会自动压缩保存</span>
                </div>
              </div>
            </div>
          )}
          {messages.map((message) => {
            const isGeneratedImageMessage = message.role === "assistant" && message.image_ids.length > 0;
            return (
            <article key={message.id} className={`message ${message.role} ${isGeneratedImageMessage ? "image-only" : ""}`}>
              {message.meta?.pending ? (
                <div className="bubble chat-loading" role="status" aria-live="polite">
                  <span />
                  <span />
                  <span />
                </div>
              ) : (
                <div className={`bubble ${isGeneratedImageMessage ? "image-bubble" : ""}`}>
                  {!isGeneratedImageMessage && message.content && <p>{message.content}</p>}
                  {message.image_ids.length > 0 && (
                    <div className={isGeneratedImageMessage ? "image-result" : "message-images"}>
                      {message.image_ids.map((id) => {
                        const image = imageById.get(id);
                        if (!image) return null;
                        return (
                          <button
                            className={
                              isGeneratedImageMessage
                                ? "image-result-tile"
                                : `image-tile ${selectedImages.includes(id) ? "selected" : ""}`
                            }
                            key={id}
                            onClick={() => toggleImage(id)}
                            onDoubleClick={() => openPreview(image)}
                            title="双击放大"
                          >
                            <img src={image.url} alt={image.prompt || image.original_name || "会话图片"} />
                            {!isGeneratedImageMessage && <span>{selectedImages.includes(id) ? "已选参考" : "选作参考"}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
          })}
          {isCurrentSessionGenerating && (
            <article className="message assistant">
              <div className="image-generating-card" role="status" aria-live="polite">
                <div className="image-generating-pattern" />
                <div className="image-generating-copy">
                  <span>正在创建图片</span>
                  <i />
                </div>
              </div>
            </article>
          )}
          <div ref={messagesEndRef} />
        </section>

        {hasMessages && <footer className="composer-wrap">
          {error && <div className="error-line">{error}</div>}
          <ReferenceStrip
            images={images}
            selectedImages={selectedImages}
            toggleImage={toggleImage}
          />
          <PromptBox
            prompt={prompt}
            setPrompt={setPrompt}
            sendMessage={sendMessage}
            uploadFiles={uploadFiles}
            uploading={uploading}
            busy={isCurrentSessionBusy}
          />
        </footer>}
      </main>

      {authOpen && (
        <div className="auth-modal" role="dialog" aria-modal="true" onClick={() => setAuthOpen(false)}>
          <div className="auth-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-head">
              <h2>{authMode === "login" ? "登录账号" : "注册账号"}</h2>
              <button className="icon-button" onClick={() => setAuthOpen(false)} title="关闭">
                <X size={18} />
              </button>
            </div>
            <label className="auth-field">
              <span>用户名</span>
              <input
                value={authForm.username}
                onChange={(event) => setAuthForm((form) => ({ ...form, username: event.target.value }))}
                placeholder="至少 3 位"
              />
            </label>
            <label className="auth-field">
              <span>密码</span>
              <input
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm((form) => ({ ...form, password: event.target.value }))}
                placeholder="至少 6 位"
              />
            </label>
            {authError && <div className="error-line">{authError}</div>}
            <button
              className="auth-submit"
              disabled={!authForm.username.trim() || !authForm.password.trim()}
              onClick={() => void submitAuth()}
            >
              {authMode === "login" ? "登录" : "注册"}
            </button>
            <button
              className="auth-switch"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
            >
              {authMode === "login" ? "没有账号？注册" : "已有账号？登录"}
            </button>
          </div>
        </div>
      )}

      {previewImage && (
        <div className="image-preview" role="dialog" aria-modal="true" onClick={closePreview}>
          <div className="image-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="image-preview-toolbar">
              <div>
                <strong>{previewImage.prompt || previewImage.original_name || "图片预览"}</strong>
                <span>{previewImage.mime_type}</span>
              </div>
              <div className="image-preview-actions">
                <a href={previewImage.url} download={previewImage.filename} title="保存图片">
                  <Download size={18} />
                  保存
                </a>
                <button type="button" onClick={closePreview} title="关闭">
                  <X size={18} />
                </button>
              </div>
            </div>
            <img src={previewImage.url} alt={previewImage.prompt || previewImage.original_name || "放大图片"} />
          </div>
        </div>
      )}

      <aside className={`settings-panel ${settingsOpen ? "is-open" : ""}`}>
        <div className="panel-head">
          <h2>生成参数</h2>
          <button className="icon-button" onClick={() => setSettingsOpen(false)} title="关闭">
            <X size={18} />
          </button>
        </div>
        <ControlGroup label="画质">
          <Segmented
            value={options.quality}
            items={["auto", "low", "medium", "high"]}
            onChange={(quality) => setOptions((item) => ({ ...item, quality: quality as ImageQuality }))}
          />
        </ControlGroup>
        <ControlGroup label="大小">
          <select
            value={options.size}
            onChange={(event) => setOptions((item) => ({ ...item, size: event.target.value as ImageSize }))}
          >
            <option value="auto">自动</option>
            <option value="1024x1024">方图 1024</option>
            <option value="1536x1024">横图 1536x1024</option>
            <option value="1024x1536">竖图 1024x1536</option>
          </select>
        </ControlGroup>
        <ControlGroup label="格式">
          <Segmented
            value={options.format}
            items={["png", "jpeg", "webp"]}
            onChange={(format) => setOptions((item) => ({ ...item, format: format as ImageFormat }))}
          />
        </ControlGroup>
        <ControlGroup label={`压缩 ${options.compression}`}>
          <input
            type="range"
            min="0"
            max="100"
            value={options.compression}
            disabled={options.format === "png"}
            onChange={(event) =>
              setOptions((item) => ({ ...item, compression: Number(event.target.value) }))
            }
          />
        </ControlGroup>
      </aside>
    </div>
  );
}

function PromptBox({
  prompt,
  setPrompt,
  sendMessage,
  uploadFiles,
  uploading,
  busy,
  variant = "dock"
}: {
  prompt: string;
  setPrompt: (prompt: string) => void;
  sendMessage: () => void;
  uploadFiles: (files: FileList | null) => void;
  uploading: boolean;
  busy: boolean;
  variant?: "home" | "dock";
}) {
  return (
    <div className={`composer ${variant === "home" ? "home-composer" : ""}`}>
      <label className="upload-button" title="上传参考图">
        <Plus size={21} strokeWidth={1.9} />
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => void uploadFiles(event.target.files)}
          disabled={uploading || busy}
        />
      </label>
      <div className="prompt-field">
        <textarea
          value={prompt}
          placeholder="有问题，尽管问"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
        />
      </div>
      <button
        className="send-button"
        disabled={!prompt.trim() || busy}
        onClick={() => void sendMessage()}
        title="发送"
      >
        <Send size={19} />
      </button>
    </div>
  );
}

function ReferenceStrip({
  images,
  selectedImages,
  toggleImage
}: {
  images: ImageAsset[];
  selectedImages: string[];
  toggleImage: (id: string) => void;
}) {
  const selected = images.filter((image) => selectedImages.includes(image.id));
  if (!selected.length) return null;
  return (
    <div className="reference-strip">
      {selected.map((image) => (
        <button key={image.id} onClick={() => toggleImage(image.id)}>
          <img src={image.url} alt={image.prompt || "参考图"} />
          <X size={14} />
        </button>
      ))}
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="control-group">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Segmented({
  value,
  items,
  onChange
}: {
  value: string;
  items: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          className={value === item ? "active" : ""}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
