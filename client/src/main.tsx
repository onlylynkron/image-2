import React from "react";
import { createRoot } from "react-dom/client";
import {
  Copy,
  Download,
  Edit3,
  Pencil,
  MoreHorizontal,
  Pin,
  PinOff,
  LogOut,
  MessageSquareX,
  Menu,
  MessageSquarePlus,
  Moon,
  Plus,
  Send,
  Settings,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X
} from "lucide-react";
import "./styles.css";

type ImageQuality = "auto" | "low" | "medium" | "high";
type ImageSize = "auto" | "1024x1024" | "1536x1024" | "1024x1536";
type ImageFormat = "png" | "jpeg" | "webp";
type ImageAspectRatio = "auto" | "1:1" | "21:9" | "16:9" | "3:2" | "4:3";
type ImageResolution = "1K" | "2K" | "4K";

interface ImageOptions {
  quality: ImageQuality;
  size: ImageSize;
  aspect_ratio: ImageAspectRatio;
  resolution: ImageResolution;
  image_count: number;
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

interface PublicConfig {
  google_auth_enabled: boolean;
  google_client_id: string;
}

interface LocalSnapshot {
  sessions: SessionItem[];
  details: Record<string, { session: SessionItem; messages: ChatMessage[]; images: ImageAsset[] }>;
}

const defaultOptions: ImageOptions = {
  quality: "high",
  size: "auto",
  aspect_ratio: "auto",
  resolution: "1K",
  image_count: 1,
  format: "png",
  compression: 85
};

function normalizeOptions(options?: Partial<ImageOptions> | null): ImageOptions {
  return { ...defaultOptions, ...(options || {}) };
}

const LOCAL_HISTORY_KEY = "image2.localHistory.v1";
const AUTH_KEY = "image2.auth.v1";
const THEME_KEY = "image2.theme.v1";
const PINNED_SESSIONS_KEY = "image2.pinnedSessions.v1";
const authText = {
  loginTitle: "\u6b22\u8fce\u56de\u6765",
  registerTitle: "\u521b\u5efa\u8d26\u53f7",
  loginIntro: "\u767b\u5f55\u540e\u53ef\u5728\u591a\u8bbe\u5907\u540c\u6b65 Image Studio \u4f1a\u8bdd\u3002",
  registerIntro: "\u6ce8\u518c\u540e\u4f1a\u628a\u672c\u5730\u5386\u53f2\u540c\u6b65\u5230\u4f60\u7684\u8d26\u53f7\u3002",
  modeLabel: "\u767b\u5f55\u65b9\u5f0f",
  login: "\u767b\u5f55",
  register: "\u6ce8\u518c",
  loadingGoogle: "\u6b63\u5728\u52a0\u8f7d Google \u767b\u5f55...",
  or: "\u6216",
  username: "\u7528\u6237\u540d",
  password: "\u5bc6\u7801",
  loginUsernamePlaceholder: "\u8bf7\u8f93\u5165\u7528\u6237\u540d",
  loginPasswordPlaceholder: "\u8bf7\u8f93\u5165\u5bc6\u7801",
  usernamePlaceholder: "\u81f3\u5c11 3 \u4f4d",
  passwordPlaceholder: "\u81f3\u5c11 6 \u4f4d",
  googleLoadFailed: "Google \u767b\u5f55\u52a0\u8f7d\u5931\u8d25",
  googleFailed: "Google \u767b\u5f55\u5931\u8d25"
};

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

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (element: HTMLElement | null, options: Record<string, string | number>) => void;
        };
      };
    };
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readTheme(): "light" | "dark" {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
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

function readPinnedSessions(): string[] {
  try {
    const saved = localStorage.getItem(PINNED_SESSIONS_KEY);
    return saved ? (JSON.parse(saved) as string[]) : [];
  } catch {
    return [];
  }
}

function writePinnedSessions(ids: string[]) {
  localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(ids));
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

const forcedImageIntentRules = [
  new RegExp("\\u91cd\\u65b0\\u751f\\u6210|\\u91cd\\u65b0\\u51fa\\u56fe|\\u91cd\\u65b0\\u751f\\u56fe|\\u518d\\u6b21\\u751f\\u6210|\\u518d\\u751f\\u6210\\u4e00\\u6b21|\\u91cd\\u65b0\\u753b|\\u91cd\\u65b0\\u7ed8\\u5236|\\u91cd\\u65b0\\u6e32\\u67d3", "i"),
  new RegExp("(\\u6309|\\u7528|\\u6839\\u636e|\\u57fa\\u4e8e).*(\\u8fd9\\u4e2a|\\u8fd9\\u6bb5|\\u6b64|\\u4e0a\\u9762|\\u4ee5\\u4e0a).*(\\u63d0\\u793a\\u8bcd|prompt).*(\\u751f\\u6210|\\u751f\\u56fe|\\u51fa\\u56fe|\\u753b|\\u7ed8\\u5236|\\u6e32\\u67d3|\\u5236\\u4f5c|\\u4fee\\u6539|\\u7f16\\u8f91|\\u4fee\\u56fe|\\u5904\\u7406)", "i"),
  new RegExp("(\\u4fee\\u6539|\\u7f16\\u8f91|\\u4fee\\u56fe|\\u5904\\u7406|\\u6539\\u4e00\\u4e0b|\\u8c03\\u6574|\\u53bb\\u9664|\\u53bb\\u6389|\\u5220\\u9664|\\u4fee\\u590d|\\u66ff\\u6362|\\u6362).*(\\u4e0a\\u9762|\\u4e0a\\u4e00\\u5f20|\\u524d\\u9762|\\u521a\\u624d|\\u8fd9\\u5f20|\\u8fd9\\u4e2a|\\u56fe\\u7247|\\u56fe\\u50cf|\\u7167\\u7247|\\u56fe)", "i"),
  new RegExp("(\\u4e0a\\u9762|\\u4e0a\\u4e00\\u5f20|\\u524d\\u9762|\\u521a\\u624d|\\u8fd9\\u5f20|\\u8fd9\\u4e2a).*(\\u56fe\\u7247|\\u56fe\\u50cf|\\u7167\\u7247|\\u56fe).*(\\u4fee\\u6539|\\u7f16\\u8f91|\\u4fee\\u56fe|\\u5904\\u7406|\\u8c03\\u6574|\\u53bb\\u9664|\\u53bb\\u6389|\\u5220\\u9664|\\u4fee\\u590d|\\u66ff\\u6362|\\u6362)", "i"),
  new RegExp("(?:^|\\n)\\s*(\\u63d0\\u793a\\u8bcd|prompt)\\s*[:\\uff1a][\\s\\S]{8,}", "i")
];

const previousImageIntentRules = [
  new RegExp("(\\u4e0a\\u9762|\\u4e0a\\u4e00\\u5f20|\\u524d\\u9762|\\u521a\\u624d|\\u8fd9\\u5f20|\\u8fd9\\u4e2a|\\u6211\\u4e0a\\u9762).*(\\u56fe\\u7247|\\u56fe\\u50cf|\\u7167\\u7247|\\u56fe)", "i"),
  new RegExp("(\\u4fee\\u6539|\\u7f16\\u8f91|\\u4fee\\u56fe|\\u5904\\u7406|\\u8c03\\u6574|\\u53bb\\u9664|\\u53bb\\u6389|\\u5220\\u9664|\\u4fee\\u590d|\\u66ff\\u6362|\\u6362).*(\\u4e0a\\u9762|\\u4e0a\\u4e00\\u5f20|\\u524d\\u9762|\\u521a\\u624d|\\u8fd9\\u5f20|\\u8fd9\\u4e2a)", "i")
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
  if (forcedImageIntentRules.some((rule) => rule.test(content))) return true;
  if (previousImageIntentRules.some((rule) => rule.test(content))) return true;
  if (chatIntentRules.some((rule) => rule.test(content))) return false;
  return imageIntentRules.some((rule) => rule.test(content));
}

function shouldUsePreviousImage(content: string) {
  return previousImageIntentRules.some((rule) => rule.test(content));
}

function App() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => readTheme());
  const [auth, setAuth] = React.useState<AuthState | null>(() => readAuth());
  const [authOpen, setAuthOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<"login" | "register">("login");
  const [authForm, setAuthForm] = React.useState({ username: "", password: "" });
  const [publicConfig, setPublicConfig] = React.useState<PublicConfig | null>(null);
  const [googleReady, setGoogleReady] = React.useState(false);
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [activeId, setActiveId] = React.useState("");
  const [sessionMenuId, setSessionMenuId] = React.useState("");
  const [pinnedSessionIds, setPinnedSessionIds] = React.useState<string[]>(() => readPinnedSessions());
  const [completedSessionIds, setCompletedSessionIds] = React.useState<string[]>([]);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [images, setImages] = React.useState<ImageAsset[]>([]);
  const [prompt, setPrompt] = React.useState("");
  const [options, setOptions] = React.useState<ImageOptions>(defaultOptions);
  const [selectedImages, setSelectedImages] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [busyBySession, setBusyBySession] = React.useState<Record<string, "chat" | "image">>({});
  const [pendingBySession, setPendingBySession] = React.useState<Record<string, ChatMessage[]>>({});
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [previewImage, setPreviewImage] = React.useState<ImageAsset | null>(null);
  const [error, setError] = React.useState("");
  const [authError, setAuthError] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const skipNextLoadRef = React.useRef("");
  const activeIdRef = React.useRef("");
  const streamControllersRef = React.useRef<Record<string, AbortController>>({});

  const isLoggedIn = Boolean(auth?.token);
  const activeSession = sessions.find((session) => session.id === activeId);
  const orderedSessions = React.useMemo(() => {
    const pinned = new Set(pinnedSessionIds);
    return [...sessions].sort((a, b) => {
      const aPinned = pinned.has(a.id);
      const bPinned = pinned.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return sessions.indexOf(a) - sessions.indexOf(b);
    });
  }, [sessions, pinnedSessionIds]);
  const imageById = React.useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images]
  );
  const hasMessages = messages.length > 0;
  const currentBusyType = activeId ? busyBySession[activeId] : undefined;
  const isCurrentSessionBusy = Boolean(currentBusyType);
  const isCurrentSessionGenerating = currentBusyType === "image";
  const canStopCurrentChat = currentBusyType === "chat";

  React.useEffect(() => {
    void bootstrap();
  }, [auth?.token]);

  React.useEffect(() => {
    void loadPublicConfig();
  }, []);

  React.useEffect(() => {
    if (!authOpen || !publicConfig?.google_auth_enabled || !publicConfig.google_client_id) return;
    let cancelled = false;
    loadGoogleIdentity().then(() => {
      if (cancelled) return;
      const google = window.google?.accounts?.id;
      if (!google) return;
      const buttonHost = document.getElementById("google-signin-button");
      buttonHost?.replaceChildren();
      google.initialize({
        client_id: publicConfig.google_client_id,
        callback: (response) => void submitGoogleAuth(response.credential)
      });
      google.renderButton(buttonHost, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: authMode === "login" ? "signin_with" : "continue_with",
        width: 320
      });
      setGoogleReady(true);
    }).catch(() => setGoogleReady(false));
    return () => {
      cancelled = true;
    };
  }, [authOpen, authMode, publicConfig?.google_auth_enabled, publicConfig?.google_client_id]);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  React.useEffect(() => {
    writePinnedSessions(pinnedSessionIds);
  }, [pinnedSessionIds]);

  React.useEffect(() => {
    activeIdRef.current = activeId;
    if (activeId) {
      setCompletedSessionIds((ids) => ids.filter((id) => id !== activeId));
      setSessionMenuId("");
    }
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

  async function loadPublicConfig() {
    try {
      const result = await api.json<PublicConfig>("/api/config");
      setPublicConfig(result);
    } catch {
      setPublicConfig({ google_auth_enabled: false, google_client_id: "" });
    }
  }

  function loadGoogleIdentity() {
    if (window.google?.accounts?.id) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-google-identity]");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(authText.googleLoadFailed)), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(authText.googleLoadFailed));
      document.head.appendChild(script);
    });
  }

  function mergePendingMessages(baseMessages: ChatMessage[], sessionId: string) {
    const pendingMessages = pendingBySession[sessionId] || [];
    if (!pendingMessages.length) return baseMessages;
    const existingIds = new Set(baseMessages.map((message) => message.id));
    return [...baseMessages, ...pendingMessages.filter((message) => !existingIds.has(message.id))];
  }

  function setSessionPendingMessages(sessionId: string, pendingMessages: ChatMessage[]) {
    setPendingBySession((current) => ({ ...current, [sessionId]: pendingMessages }));
  }

  function clearSessionPendingMessages(sessionId: string) {
    setPendingBySession((current) => {
      if (!current[sessionId]) return current;
      const { [sessionId]: _removed, ...rest } = current;
      return rest;
    });
  }

  function findLastAvailableImageId() {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      for (let imageIndex = message.image_ids.length - 1; imageIndex >= 0; imageIndex -= 1) {
        const imageId = message.image_ids[imageIndex];
        if (imageById.has(imageId)) return imageId;
      }
    }
    return "";
  }

  async function loadSession(id: string) {
    if (!auth?.token) {
      const detail = readLocalHistory().details[id];
      if (!detail) return;
      setMessages(mergePendingMessages(detail.messages, id));
      setImages(detail.images);
      setOptions(normalizeOptions(detail.session.options));
      setSelectedImages([]);
      return;
    }
    const detail = await api.json<{
      session: SessionItem;
      messages: ChatMessage[];
      images: ImageAsset[];
    }>(`/api/sessions/${id}`, undefined, auth.token);
    setMessages(mergePendingMessages(detail.messages, id));
    setImages(detail.images);
    setOptions(normalizeOptions(detail.session.options));
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

  function markSessionComplete(sessionId: string) {
    if (activeIdRef.current === sessionId) return;
    setCompletedSessionIds((ids) => (ids.includes(sessionId) ? ids : [...ids, sessionId]));
  }

  function togglePinnedSession(sessionId: string) {
    setPinnedSessionIds((ids) =>
      ids.includes(sessionId) ? ids.filter((id) => id !== sessionId) : [sessionId, ...ids]
    );
    setSessionMenuId("");
  }

  function selectSession(sessionId: string) {
    setActiveId(sessionId);
    setCompletedSessionIds((ids) => ids.filter((id) => id !== sessionId));
    setSidebarOpen(false);
    setSessionMenuId("");
  }

  async function renameSession(session: SessionItem) {
    const nextTitle = window.prompt("修改会话名称", session.title)?.trim();
    if (!nextTitle || nextTitle === session.title) {
      setSessionMenuId("");
      return;
    }
    setError("");
    try {
      if (!auth?.token) {
        const snapshot = readLocalHistory();
        const nextSessions = snapshot.sessions.map((item) =>
          item.id === session.id ? { ...item, title: nextTitle, updated_at: nowIso() } : item
        );
        const nextDetails = { ...snapshot.details };
        if (nextDetails[session.id]) {
          nextDetails[session.id] = {
            ...nextDetails[session.id],
            session: { ...nextDetails[session.id].session, title: nextTitle, updated_at: nowIso() }
          };
        }
        writeLocalHistory({ sessions: nextSessions, details: nextDetails });
        setSessions(nextSessions);
        return;
      }
      const updated = await api.json<SessionItem>(`/api/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: nextTitle })
      }, auth.token);
      setSessions((items) => items.map((item) => (item.id === session.id ? { ...item, ...updated } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改会话名称失败");
    } finally {
      setSessionMenuId("");
    }
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

  function updateStreamingMessage(sessionId: string, messageId: string, message: ChatMessage) {
    if (activeIdRef.current === sessionId) replaceMessage(messageId, message);
    setPendingBySession((current) => {
      const pendingMessages = current[sessionId];
      if (!pendingMessages) return current;
      return {
        ...current,
        [sessionId]: pendingMessages.map((item) => (item.id === messageId ? message : item))
      };
    });
  }

  function updateSessionMessage(sessionId: string, messageId: string, message: ChatMessage) {
    if (activeIdRef.current === sessionId) replaceMessage(messageId, message);
    setPendingBySession((current) => {
      const pendingMessages = current[sessionId];
      if (!pendingMessages) return current;
      return {
        ...current,
        [sessionId]: pendingMessages.map((item) => (item.id === messageId ? message : item))
      };
    });
  }

  function stopCurrentChat() {
    if (!activeId) return;
    streamControllersRef.current[activeId]?.abort();
  }

  async function readChatStream(
    response: Response,
    onEvent: (event: string, data: Record<string, unknown>) => void
  ) {
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail = payload?.detail?.error || payload?.detail || payload?.error || "请求失败";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("浏览器不支持流式响应。");

    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const rawEvent of events) {
        const parsed = parseSseEvent(rawEvent);
        if (parsed) onEvent(parsed.event, parsed.data);
      }
    }
    buffer += decoder.decode();
    const parsed = parseSseEvent(buffer);
    if (parsed) onEvent(parsed.event, parsed.data);
  }

  function parseSseEvent(rawEvent: string) {
    const lines = rawEvent.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return null;
    return { event, data: JSON.parse(data) as Record<string, unknown> };
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
      try {
        await syncLocalHistory(result.token);
      } catch (syncError) {
        setError(syncError instanceof Error ? `历史同步失败：${syncError.message}` : "历史同步失败");
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "登录失败");
    }
  }

  async function submitGoogleAuth(credential: string) {
    if (!credential) return;
    setAuthError("");
    try {
      const result = await api.json<AuthState>("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential })
      });
      writeAuth(result);
      setAuth(result);
      setAuthOpen(false);
      setAuthForm({ username: "", password: "" });
      try {
        await syncLocalHistory(result.token);
      } catch (syncError) {
        setError(syncError instanceof Error ? `历史同步失败：${syncError.message}` : "历史同步失败");
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : authText.googleFailed);
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
    setSessionMenuId("");
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
        setPinnedSessionIds((ids) => ids.filter((id) => id !== sessionId));
        setCompletedSessionIds((ids) => ids.filter((id) => id !== sessionId));
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
      setPinnedSessionIds((ids) => ids.filter((id) => id !== sessionId));
      setCompletedSessionIds((ids) => ids.filter((id) => id !== sessionId));
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
    const trimmedPrompt = prompt.trim();
    const fallbackImageId = !selectedImages.length && shouldUsePreviousImage(trimmedPrompt) ? findLastAvailableImageId() : "";
    const effectiveSelectedCount = selectedImages.length || (fallbackImageId ? 1 : 0);
    if (isImageRequest(trimmedPrompt, effectiveSelectedCount)) {
      await generateImage();
      return;
    }
    setError("");
    const nextPrompt = trimmedPrompt;
    setPrompt("");
    let optimisticMessages = messages;
    let pendingId = "";
    let sessionId = activeId;
    let accumulatedContent = "";
    let finalMessages: ChatMessage[] | null = null;
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
      setSessionPendingMessages(sessionId, [userMessage, pendingMessage]);
      markSessionBusy(sessionId, "chat");

      const controller = new AbortController();
      streamControllersRef.current[sessionId] = controller;
      const response = await fetch(auth?.token ? "/api/sessions/" + sessionId + "/chat/stream" : "/api/guest/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth?.token ? { Authorization: "Bearer " + auth.token } : {})
        },
        body: JSON.stringify({
          content: nextPrompt,
          ...(!auth?.token ? { messages: optimisticMessages.filter((message) => !message.meta?.pending) } : {})
        }),
        signal: controller.signal
      });

      await readChatStream(response, (event, data) => {
        if (event === "start" && auth?.token && data.userMessage) {
          const serverUserMessage = data.userMessage as ChatMessage;
          optimisticMessages = optimisticMessages.map((message) =>
            message.id === userMessage.id ? serverUserMessage : message
          );
          updateSessionMessage(sessionId, userMessage.id, serverUserMessage);
          return;
        }
        if (event === "delta") {
          accumulatedContent += String(data.text || "");
          updateStreamingMessage(sessionId, pendingId, {
            ...pendingMessage,
            content: accumulatedContent,
            meta: { pending: true, streaming: true }
          });
          return;
        }
        if (event === "done") {
          const assistantMessage = auth?.token
            ? (data.assistantMessage as ChatMessage)
            : ({
                ...pendingMessage,
                content: String(data.content || accumulatedContent),
                meta: (data.meta as Record<string, unknown> | undefined) || {}
              } satisfies ChatMessage);
          finalMessages = optimisticMessages.map((message) =>
            message.id === pendingId ? assistantMessage : message
          );
          updateStreamingMessage(sessionId, pendingId, assistantMessage);
          return;
        }
        if (event === "error") {
          const partialMessage = data.assistantMessage as ChatMessage | undefined;
          if (partialMessage) updateStreamingMessage(sessionId, pendingId, partialMessage);
          throw new Error(String(data.error || "Reply failed"));
        }
      });

      if (!auth?.token) {
        saveLocalDetail(sessionId, finalMessages || optimisticMessages, images);
        markSessionComplete(sessionId);
        return;
      }
      await refreshSessions();
      markSessionComplete(sessionId);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError" && pendingId) {
        const interruptedMessage: ChatMessage = {
          id: pendingId,
          session_id: sessionId,
          role: "assistant",
          content: accumulatedContent || "Stopped",
          image_ids: [],
          created_at: nowIso(),
          meta: { interrupted: true }
        };
        updateStreamingMessage(sessionId, pendingId, interruptedMessage);
        if (!auth?.token && sessionId) {
          saveLocalDetail(
            sessionId,
            optimisticMessages.map((message) => (message.id === pendingId ? interruptedMessage : message)),
            images
          );
        } else {
          await refreshSessions();
        }
        markSessionComplete(sessionId);
        return;
      }
      setError(err instanceof Error ? err.message : "Reply failed");
      if (pendingId) {
        const failedMessage: ChatMessage = {
          id: pendingId,
          session_id: sessionId,
          role: "assistant",
          content: err instanceof Error ? "Reply failed: " + err.message : "Reply failed",
          image_ids: [],
          created_at: nowIso(),
          meta: { error: true }
        };
        updateStreamingMessage(sessionId, pendingId, failedMessage);
        if (!auth?.token && sessionId) {
          saveLocalDetail(
            sessionId,
            optimisticMessages.map((message) => (message.id === pendingId ? failedMessage : message)),
            images
          );
        }
        markSessionComplete(sessionId);
      } else if (activeId) {
        await loadSession(activeId);
      }
    } finally {
      delete streamControllersRef.current[sessionId];
      clearSessionPendingMessages(sessionId);
      clearSessionBusy(sessionId);
    }
  }

  async function generateImage() {
    if (!prompt.trim() || isCurrentSessionBusy) return;
    setError("");
    const nextPrompt = prompt.trim();
    const wantsPreviousImage = shouldUsePreviousImage(nextPrompt);
    const fallbackImageId = !selectedImages.length && wantsPreviousImage ? findLastAvailableImageId() : "";
    const sourceImageIds = selectedImages.length ? selectedImages : fallbackImageId ? [fallbackImageId] : [];
    if (wantsPreviousImage && !sourceImageIds.length) {
      setError("\u8bf7\u5148\u4e0a\u4f20\u6216\u751f\u6210\u4e00\u5f20\u56fe\u7247\uff0c\u518d\u8ba9\u6211\u5904\u7406\u5b83\u3002");
      return;
    }
    setPrompt("");
    setSelectedImages([]);
    let optimisticMessages = messages;
    let sessionId = activeId;
    try {
      sessionId = await ensureSession();
      const sourceImages = images.filter((image) => sourceImageIds.includes(image.id));
      const userMessage: ChatMessage = {
        id: createId(),
        session_id: sessionId,
        role: "user",
        content: nextPrompt,
        image_ids: sourceImageIds,
        created_at: nowIso()
      };
      optimisticMessages = [...messages, userMessage];
      setMessages(optimisticMessages);
      setSessionPendingMessages(sessionId, [userMessage]);
      markSessionBusy(sessionId, "image");
      if (!auth?.token) {
        const result = await api.json<{
          content: string;
          image: ImageAsset;
          images?: ImageAsset[];
          meta?: Record<string, unknown>;
        }>("/api/guest/generate", {
          method: "POST",
          body: JSON.stringify({
            prompt: nextPrompt,
            options,
            image_count: options.image_count,
            messages: optimisticMessages,
            source_images: sourceImages.map((image) => ({
              id: image.id,
              filename: image.filename,
              original_name: image.original_name,
              mime_type: image.mime_type
            }))
          })
        });
        const generatedImages = (result.images?.length ? result.images : [result.image]).map((image) => ({
          ...image,
          id: createId(),
          session_id: sessionId
        }));
        const assistantMessage: ChatMessage = {
          id: createId(),
          session_id: sessionId,
          role: "assistant",
          content: result.content,
          image_ids: generatedImages.map((image) => image.id),
          created_at: nowIso(),
          meta: result.meta
        };
        const nextMessages = [...optimisticMessages, assistantMessage];
        const nextImages = [...images, ...generatedImages];
        if (activeIdRef.current === sessionId) {
          setMessages(nextMessages);
          setImages(nextImages);
        }
        saveLocalDetail(sessionId, nextMessages, nextImages, options);
        markSessionComplete(sessionId);
        return;
      }
      const result = await api.json<{
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
        image: ImageAsset;
        images?: ImageAsset[];
      }>("/api/sessions/" + sessionId + "/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt: nextPrompt,
          options,
          image_count: options.image_count,
          source_image_ids: sourceImageIds
        })
      }, auth.token);
      if (activeIdRef.current === sessionId) {
        setMessages((items) => [...items, result.assistantMessage]);
        setImages((items) => [...items, ...(result.images?.length ? result.images : [result.image])]);
      }
      await refreshSessions();
      markSessionComplete(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed");
      const failedMessage: ChatMessage = {
        id: createId(),
        session_id: sessionId,
        role: "assistant",
        content: err instanceof Error ? "Image generation failed: " + err.message : "Image generation failed",
        image_ids: [],
        created_at: nowIso(),
        meta: { error: true }
      };
      if (activeIdRef.current === sessionId) setMessages([...optimisticMessages, failedMessage]);
      if (!auth?.token && sessionId) saveLocalDetail(sessionId, [...optimisticMessages, failedMessage], images, options);
      markSessionComplete(sessionId);
    } finally {
      clearSessionPendingMessages(sessionId);
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

  async function copyMessage(content: string) {
    if (!content.trim()) return;
    try {
      await navigator.clipboard?.writeText(content);
    } catch {
      // Clipboard permissions can be unavailable outside secure browser contexts.
    }
  }

  function editMessage(content: string) {
    setPrompt(content);
  }

  function toggleTheme() {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <button className="brand-button" onClick={createSession}>
            <Sparkles size={19} />
            <span>Image Studio</span>
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
          {orderedSessions.map((session) => {
            const isPinned = pinnedSessionIds.includes(session.id);
            const isBusy = Boolean(busyBySession[session.id]);
            const isComplete = completedSessionIds.includes(session.id);
            const isMenuOpen = sessionMenuId === session.id;
            return (
              <div
                key={session.id}
                className={`session-row ${session.id === activeId ? "active" : ""} ${isMenuOpen ? "menu-open" : ""}`}
              >
                <button
                  className="session-item"
                  onClick={() => selectSession(session.id)}
                >
                  <span>{session.title}</span>
                  <small>{session.message_count} 条消息 · {session.image_count} 张图</small>
                </button>
                <div className="session-status" aria-hidden="true">
                  {isBusy && <span className="session-spinner" />}
                  {!isBusy && isComplete && <span className="session-unread-dot" />}
                </div>
                <button
                  className="session-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSessionMenuId((id) => (id === session.id ? "" : session.id));
                  }}
                  title="会话操作"
                >
                  <MoreHorizontal size={18} />
                </button>
                {isMenuOpen && (
                  <div className="session-menu" role="menu">
                    <button onClick={() => void renameSession(session)} role="menuitem">
                      <Edit3 size={16} />
                      重命名
                    </button>
                    <button onClick={() => togglePinnedSession(session.id)} role="menuitem">
                      {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                      {isPinned ? "取消置顶" : "置顶聊天"}
                    </button>
                    <button
                      className="danger"
                      onClick={() => void deleteSession(session.id, session.title)}
                      role="menuitem"
                    >
                      <Trash2 size={16} />
                      删除
                    </button>
                  </div>
                )}
              </div>
            );
          })}
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
            <strong>{activeSession?.title || "Image Studio"}</strong>
            {/*<span>独立上下文 · 本地历史</span>*/}
          </div>
          <button
            className="icon-button theme-toggle"
            onClick={toggleTheme}
            title={theme === "light" ? "切换黑色主题" : "切换白色主题"}
          >
            {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="生成参数">
            <Settings size={20} />
          </button>
        </header>

        <section className="conversation">
          {!hasMessages && (
            <div className="home-state">
              <div className="home-brand">
                <Sparkles size={18} />
                <span>Image Studio</span>
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
                  canStop={canStopCurrentChat}
                  stopMessage={stopCurrentChat}
                  variant="home"
                />
              </div>
            </div>
          )}
          {messages.map((message) => {
            const isGeneratedImageMessage = message.role === "assistant" && message.image_ids.length > 0;
            const isUserImageEditMessage = message.role === "user" && message.image_ids.length > 0;
            return (
            <article
              key={message.id}
              className={`message ${message.role} ${isGeneratedImageMessage ? "image-only" : ""} ${isUserImageEditMessage ? "image-edit-request" : ""}`}
            >
              {message.meta?.pending && !message.content ? (
                <div className="bubble chat-loading" role="status" aria-live="polite">
                  <span />
                  <span />
                  <span />
                </div>
              ) : (
                <div className={`bubble ${isGeneratedImageMessage ? "image-bubble" : ""}`}>
                  {!isGeneratedImageMessage && message.content && <MarkdownMessage content={message.content} />}
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
                  {isUserImageEditMessage && (
                    <div className="message-actions" aria-label="消息操作">
                      <button onClick={() => void copyMessage(message.content)} title="复制">
                        <Copy size={16} />
                      </button>
                      <button onClick={() => editMessage(message.content)} title="编辑">
                        <Pencil size={16} />
                      </button>
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
                  <span>Generating image</span>
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
            canStop={canStopCurrentChat}
            stopMessage={stopCurrentChat}
          />
        </footer>}
      </main>

      {authOpen && (
        <div className="auth-modal" role="dialog" aria-modal="true" onClick={() => setAuthOpen(false)}>
          <div className="auth-panel" onClick={(event) => event.stopPropagation()}>
            <div className="auth-hero">
              <div className="auth-mark">
                <Sparkles size={20} />
              </div>
              <button className="icon-button auth-close" onClick={() => setAuthOpen(false)} title="Close">
                <X size={18} />
              </button>
              <h2>{authMode === "login" ? authText.loginTitle : authText.registerTitle}</h2>
              <p>{authMode === "login" ? authText.loginIntro : authText.registerIntro}</p>
            </div>

            <div className="auth-tabs" role="tablist" aria-label={authText.modeLabel}>
              <button
                type="button"
                className={authMode === "login" ? "active" : ""}
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                }}
              >
                {authText.login}
              </button>
              <button
                type="button"
                className={authMode === "register" ? "active" : ""}
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                }}
              >
                {authText.register}
              </button>
            </div>

            {publicConfig?.google_auth_enabled && (
              <div className="google-auth-wrap">
                <div id="google-signin-button" className="google-auth-button" />
                {!googleReady && <span>{authText.loadingGoogle}</span>}
              </div>
            )}

            {publicConfig?.google_auth_enabled && <div className="auth-divider"><span>{authText.or}</span></div>}

            <div className="auth-form-grid">
              <label className="auth-field">
                <span>{authText.username}</span>
                <input
                  value={authForm.username}
                  onChange={(event) => setAuthForm((form) => ({ ...form, username: event.target.value }))}
                  placeholder={authMode === "login" ? authText.loginUsernamePlaceholder : authText.usernamePlaceholder}
                  autoComplete="username"
                />
              </label>
              <label className="auth-field">
                <span>{authText.password}</span>
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((form) => ({ ...form, password: event.target.value }))}
                  placeholder={authMode === "login" ? authText.loginPasswordPlaceholder : authText.passwordPlaceholder}
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                />
              </label>
            </div>

            {authError && <div className="error-line auth-error">{authError}</div>}
            <button
              className="auth-submit"
              disabled={!authForm.username.trim() || !authForm.password.trim()}
              onClick={() => void submitAuth()}
            >
              {authMode === "login" ? authText.login : authText.register}
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
        <ControlGroup label="图片尺寸">
          <div className="option-grid aspect-grid">
            {[
              { value: "auto", label: "自动", shape: "auto" },
              { value: "1:1", label: "1:1", shape: "square" },
              { value: "21:9", label: "21:9", shape: "wide" },
              { value: "16:9", label: "16:9", shape: "wide" },
              { value: "3:2", label: "3:2", shape: "photo" },
              { value: "4:3", label: "4:3", shape: "classic" }
            ].map((item) => (
              <button
                key={item.value}
                className={options.aspect_ratio === item.value ? "active" : ""}
                onClick={() =>
                  setOptions((current) => ({
                    ...current,
                    aspect_ratio: item.value as ImageAspectRatio,
                    size:
                      item.value === "1:1"
                        ? "1024x1024"
                        : item.value === "auto"
                          ? "auto"
                          : "1536x1024"
                  }))
                }
              >
                <i className={`ratio-icon ${item.shape}`} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </ControlGroup>
        <ControlGroup label="分辨率">
          <div className="option-grid resolution-grid">
            {["1K", "2K", "4K"].map((resolution) => (
              <button
                key={resolution}
                className={options.resolution === resolution ? "active" : ""}
                onClick={() => setOptions((current) => ({ ...current, resolution: resolution as ImageResolution }))}
              >
                {resolution}
              </button>
            ))}
          </div>
        </ControlGroup>
        <ControlGroup label="图片数量">
          <div className="option-grid count-grid">
            {[1, 2, 3, 4].map((count) => (
              <button
                key={count}
                className={options.image_count === count ? "active" : ""}
                onClick={() => setOptions((current) => ({ ...current, image_count: count }))}
              >
                {count}
              </button>
            ))}
          </div>
        </ControlGroup>
        <ControlGroup label="画质">
          <Segmented
            value={options.quality}
            items={["auto", "low", "medium", "high"]}
            onChange={(quality) => setOptions((item) => ({ ...item, quality: quality as ImageQuality }))}
          />
        </ControlGroup>
        <ControlGroup label="API 尺寸">
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
  stopMessage,
  uploadFiles,
  uploading,
  busy,
  canStop,
  variant = "dock"
}: {
  prompt: string;
  setPrompt: (prompt: string) => void;
  sendMessage: () => void;
  stopMessage: () => void;
  uploadFiles: (files: FileList | null) => void;
  uploading: boolean;
  busy: boolean;
  canStop: boolean;
  variant?: "home" | "dock";
}) {
  return (
    <div className={"composer " + (variant === "home" ? "home-composer" : "")}>
      <label className="upload-button" title="Add reference image">
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
          placeholder="Ask anything"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canStop) stopMessage();
              else void sendMessage();
            }
          }}
        />
      </div>
      <button
        className={"send-button " + (canStop ? "is-stop" : "")}
        disabled={!canStop && (!prompt.trim() || busy)}
        onClick={() => (canStop ? stopMessage() : void sendMessage())}
        title={canStop ? "Stop" : "Send"}
      >
        {canStop ? <Square size={17} fill="currentColor" /> : <Send size={19} />}
      </button>
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className="markdown-message">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre key={index}>
              <code>{block.content}</code>
            </pre>
          );
        }
        if (block.type === "ul" || block.type === "ol") {
          const ListTag = block.type === "ul" ? "ul" : "ol";
          return (
            <ListTag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "heading") {
          if (block.level === 1) return <h1 key={index}>{renderInlineMarkdown(block.content)}</h1>;
          if (block.level === 2) return <h2 key={index}>{renderInlineMarkdown(block.content)}</h2>;
          return <h3 key={index}>{renderInlineMarkdown(block.content)}</h3>;
        }
        if (block.type === "paragraph") {
          return <p key={index}>{renderInlineMarkdown(block.content)}</p>;
        }
        return null;
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "paragraph"; content: string }
  | { type: "heading"; level: 1 | 2 | 3; content: string }
  | { type: "code"; content: string }
  | { type: "ul" | "ol"; items: string[] };

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", content: paragraph.join("\n").trim() });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        content: heading[2]
      });
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      const items = [unordered[1]];
      while (index + 1 < lines.length) {
        const next = /^[-*+]\s+(.+)$/.exec(lines[index + 1].trim());
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      const items = [ordered[1]];
      while (index + 1 < lines.length) {
        const next = /^\d+[.)]\s+(.+)$/.exec(lines[index + 1].trim());
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = nodes.length;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link?.[2] || "";
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {link?.[1] || token}
        </a>
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
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
