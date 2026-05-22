import React from "react";
import { createRoot } from "react-dom/client";
import {
  Download,
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

const defaultOptions: ImageOptions = {
  quality: "auto",
  size: "1024x1024",
  format: "png",
  compression: 85
};

const api = {
  async json<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers:
        init?.body instanceof FormData
          ? init.headers
          : { "Content-Type": "application/json", ...(init?.headers || {}) }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.detail?.error || payload?.detail || payload?.error || "请求失败";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return payload as T;
  }
};

const imageIntentRules = [
  /生成.*(图|图片|图像|照片|海报|封面|logo|头像|壁纸)/i,
  /(画|绘制|出图|做图|生图|制图|渲染)(一|个|张|幅|款|套|下)?/i,
  /(设计|制作)(一|个|张|幅|款|套).*(图|图片|海报|封面|logo|头像|产品图|效果图)/i,
  /(修改|编辑|重绘|改成|变成|换背景|去背景|抠图|修图|放大).*(图|图片|照片|这张|上一张)/i,
  /(参考图|用这张|基于这张|上一张图|这张图)/i,
  /\b(generate|create|draw|make|edit|redraw)\b.*\b(image|picture|photo|poster|logo|avatar)\b/i
];

function isImageRequest(content: string, selectedImageCount: number) {
  if (selectedImageCount > 0) return true;
  return imageIntentRules.some((rule) => rule.test(content));
}

function App() {
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [activeId, setActiveId] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [images, setImages] = React.useState<ImageAsset[]>([]);
  const [prompt, setPrompt] = React.useState("");
  const [options, setOptions] = React.useState<ImageOptions>(defaultOptions);
  const [selectedImages, setSelectedImages] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [chatting, setChatting] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [previewImage, setPreviewImage] = React.useState<ImageAsset | null>(null);
  const [error, setError] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  const activeSession = sessions.find((session) => session.id === activeId);
  const imageById = React.useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images]
  );
  const hasMessages = messages.length > 0;

  React.useEffect(() => {
    void bootstrap();
  }, []);

  React.useEffect(() => {
    if (activeId) void loadSession(activeId);
  }, [activeId]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, generating]);

  async function bootstrap() {
    const sessionList = await api.json<SessionItem[]>("/api/sessions");
    setSessions(sessionList);
    if (sessionList[0]) setActiveId(sessionList[0].id);
  }

  async function loadSession(id: string) {
    const detail = await api.json<{
      session: SessionItem;
      messages: ChatMessage[];
      images: ImageAsset[];
    }>(`/api/sessions/${id}`);
    setMessages(detail.messages);
    setImages(detail.images);
    setOptions(detail.session.options || defaultOptions);
    setSelectedImages([]);
  }

  async function createSession() {
    const session = await api.json<SessionItem>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "未命名会话" })
    });
    setSessions((items) => [session, ...items]);
    setActiveId(session.id);
    setSidebarOpen(false);
  }

  async function refreshSessions() {
    setSessions(await api.json<SessionItem[]>("/api/sessions"));
  }

  async function deleteSession(sessionId: string, title: string) {
    if (!window.confirm(`删除会话“${title}”？此操作会删除该会话的历史消息和图片。`)) {
      return;
    }
    setError("");
    try {
      const result = await api.json<{ sessions: SessionItem[] }>(`/api/sessions/${sessionId}`, {
        method: "DELETE"
      });
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
      await api.json(`/api/sessions/${activeId}/history`, { method: "DELETE" });
      setMessages([]);
      setImages([]);
      setSelectedImages([]);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除历史失败");
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !activeId) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      Array.from(files).slice(0, 6).forEach((file) => form.append("images", file));
      const uploaded = await api.json<ImageAsset[]>(`/api/sessions/${activeId}/uploads`, {
        method: "POST",
        body: form
      });
      setImages((items) => [...items, ...uploaded]);
      setSelectedImages((ids) => [...new Set([...ids, ...uploaded.map((item) => item.id)])]);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function sendMessage() {
    if (!prompt.trim() || !activeId || generating || chatting) return;
    if (isImageRequest(prompt.trim(), selectedImages.length)) {
      await generateImage();
      return;
    }
    setChatting(true);
    setError("");
    const nextPrompt = prompt.trim();
    setPrompt("");
    try {
      const result = await api.json<{
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
      }>(`/api/sessions/${activeId}/chat`, {
        method: "POST",
        body: JSON.stringify({ content: nextPrompt })
      });
      setMessages((items) => [...items, result.userMessage, result.assistantMessage]);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "回复失败");
      await loadSession(activeId);
    } finally {
      setChatting(false);
    }
  }

  async function generateImage() {
    if (!prompt.trim() || !activeId || generating) return;
    setGenerating(true);
    setError("");
    const nextPrompt = prompt.trim();
    setPrompt("");
    try {
      const result = await api.json<{
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
        image: ImageAsset;
      }>(`/api/sessions/${activeId}/generate`, {
        method: "POST",
        body: JSON.stringify({
          prompt: nextPrompt,
          options,
          source_image_ids: selectedImages
        })
      });
      setMessages((items) => [...items, result.userMessage, result.assistantMessage]);
      setImages((items) => [...items, result.image]);
      setSelectedImages([result.image.id]);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
      await loadSession(activeId);
    } finally {
      setGenerating(false);
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
                  busy={generating || chatting}
                  variant="home"
                />
                <div className="home-hint">
                  <span>支持生成与参考图编辑</span>
                  <span>历史会自动压缩保存</span>
                </div>
              </div>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <div className="bubble">
                <p>{message.content}</p>
                {message.image_ids.length > 0 && (
                  <div className="message-images">
                    {message.image_ids.map((id) => {
                      const image = imageById.get(id);
                      if (!image) return null;
                      return (
                        <button
                          className={`image-tile ${selectedImages.includes(id) ? "selected" : ""}`}
                          key={id}
                          onClick={() => toggleImage(id)}
                          onDoubleClick={() => openPreview(image)}
                          title="双击放大"
                        >
                          <img src={image.url} alt={image.prompt || image.original_name || "会话图片"} />
                          <span>{selectedImages.includes(id) ? "已选参考" : "选作参考"}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </article>
          ))}
          {generating && (
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
            busy={generating || chatting}
          />
        </footer>}
      </main>

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
