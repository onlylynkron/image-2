import React from "react";
import { createRoot } from "react-dom/client";
import {
  Download,
  ImagePlus,
  Menu,
  MessageSquarePlus,
  PanelRightOpen,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Wand2,
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

interface PublicConfig {
  base_url: string;
  image_model: string;
  text_model: string;
  has_api_key: boolean;
  storage_backend: string;
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

function App() {
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [activeId, setActiveId] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [images, setImages] = React.useState<ImageAsset[]>([]);
  const [prompt, setPrompt] = React.useState("");
  const [options, setOptions] = React.useState<ImageOptions>(defaultOptions);
  const [config, setConfig] = React.useState<PublicConfig | null>(null);
  const [configDraft, setConfigDraft] = React.useState({
    api_key: "",
    base_url: "",
    image_model: "gpt-image-2",
    text_model: "gpt-5.2"
  });
  const [selectedImages, setSelectedImages] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  const activeSession = sessions.find((session) => session.id === activeId);
  const imageById = React.useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images]
  );

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
    const [sessionList, publicConfig] = await Promise.all([
      api.json<SessionItem[]>("/api/sessions"),
      api.json<PublicConfig>("/api/config")
    ]);
    setSessions(sessionList);
    setConfig(publicConfig);
    setConfigDraft({
      api_key: "",
      base_url: publicConfig.base_url || "",
      image_model: publicConfig.image_model || "gpt-image-2",
      text_model: publicConfig.text_model || "gpt-5.2"
    });
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
      body: JSON.stringify({ title: "新图像会话" })
    });
    setSessions((items) => [session, ...items]);
    setActiveId(session.id);
    setSidebarOpen(false);
  }

  async function refreshSessions() {
    setSessions(await api.json<SessionItem[]>("/api/sessions"));
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

  async function generate() {
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

  async function saveConfig() {
    const updated = await api.json<PublicConfig>("/api/config", {
      method: "PUT",
      body: JSON.stringify(configDraft)
    });
    setConfig(updated);
    setConfigDraft((draft) => ({ ...draft, api_key: "" }));
    setSettingsOpen(false);
  }

  function toggleImage(id: string) {
    setSelectedImages((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
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
            <button
              key={session.id}
              className={`session-item ${session.id === activeId ? "active" : ""}`}
              onClick={() => {
                setActiveId(session.id);
                setSidebarOpen(false);
              }}
            >
              <span>{session.title}</span>
              <small>{session.message_count} 条消息 · {session.image_count} 张图</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button" onClick={() => setSidebarOpen(true)} title="会话">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <strong>{activeSession?.title || "图像会话"}</strong>
            <span>
              {config?.has_api_key ? config.image_model : "未配置 API Key"}
              {config?.storage_backend ? ` · ${config.storage_backend}` : ""}
            </span>
          </div>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="设置">
            <Settings size={20} />
          </button>
          <button className="icon-button desktop-hidden" onClick={() => setSettingsOpen(true)} title="参数">
            <PanelRightOpen size={20} />
          </button>
        </header>

        <section className="conversation">
          {messages.length === 0 && (
            <div className="empty-state">
              <Wand2 size={34} />
              <h1>描述一张图，或选择历史图片继续编辑</h1>
              <p>每个会话的上下文独立保存，长历史会自动压缩成可继续创作的摘要。</p>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <div className="avatar">{message.role === "user" ? "你" : "AI"}</div>
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
              <div className="avatar">AI</div>
              <div className="bubble loading">
                <RefreshCw size={17} />
                正在生成图片...
              </div>
            </article>
          )}
          <div ref={messagesEndRef} />
        </section>

        <footer className="composer-wrap">
          {error && <div className="error-line">{error}</div>}
          <ReferenceStrip
            images={images}
            selectedImages={selectedImages}
            toggleImage={toggleImage}
          />
          <div className="composer">
            <label className="upload-button" title="上传参考图">
              <ImagePlus size={20} />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => void uploadFiles(event.target.files)}
                disabled={uploading || generating}
              />
            </label>
            <textarea
              value={prompt}
              placeholder="描述你想生成或编辑的图片..."
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void generate();
                }
              }}
            />
            <button
              className="send-button"
              disabled={!prompt.trim() || generating}
              onClick={() => void generate()}
              title="发送"
            >
              <Send size={20} />
            </button>
          </div>
        </footer>
      </main>

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
        <div className="config-box">
          <h2>服务端配置</h2>
          <input
            type="password"
            placeholder={config?.has_api_key ? "已保存 API Key，留空不修改" : "OpenAI API Key"}
            value={configDraft.api_key}
            onChange={(event) => setConfigDraft((draft) => ({ ...draft, api_key: event.target.value }))}
          />
          <input
            placeholder="Base URL，可选"
            value={configDraft.base_url}
            onChange={(event) => setConfigDraft((draft) => ({ ...draft, base_url: event.target.value }))}
          />
          <input
            placeholder="图像模型"
            value={configDraft.image_model}
            onChange={(event) => setConfigDraft((draft) => ({ ...draft, image_model: event.target.value }))}
          />
          <input
            placeholder="压缩摘要模型"
            value={configDraft.text_model}
            onChange={(event) => setConfigDraft((draft) => ({ ...draft, text_model: event.target.value }))}
          />
          <button className="save-config" onClick={() => void saveConfig()}>
            保存配置
          </button>
        </div>
      </aside>
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
