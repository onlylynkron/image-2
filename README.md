# Image Studio

Image Studio 是一个带前后端的对话式生图和修图应用，支持调用 `gpt-image-2` 生成图片、基于历史上下文继续对话、读取历史图片进行编辑，并支持本地游客模式和登录后账号同步。

## 功能特性

- 调用 GPT Image 接口生成图片，默认模型为 `gpt-image-2`。
- 支持图片编辑：可上传图片、选择历史图片作为参考，也能根据“修改上一张图”这类提示自动引用最近图片。
- 聊天和生图区分处理：文本对话走聊天接口，生图和修图走图片接口。
- 聊天支持流式响应和中断。
- 多会话管理，每个会话上下文独立。
- 未登录也能使用，历史记录保存在本地浏览器；登录后可同步到账号。
- 支持用户名密码注册登录，以及可选 Google 一键登录。
- 支持删除历史对话、删除会话。
- 支持图片双击放大和保存。
- 支持画质、尺寸、格式、压缩、比例、分辨率、一次生成多张等图片参数。
- 自动压缩长历史，上下文会读取历史摘要和最近消息。
- 响应式 UI，适配桌面、平板和手机浏览器。
- 支持 PostgreSQL 入库，保存用户、会话、消息、图片元数据和图片源文件。
- 支持 Docker Compose 一键启动，自带 PostgreSQL，不需要额外安装数据库服务。

## 技术栈

- 前端：React、Vite、TypeScript、Lucide Icons
- 后端：Python、FastAPI、Uvicorn
- 存储：PostgreSQL 或本地 JSON 文件
- 容器：Docker、Docker Compose

## 快速启动：Docker Compose

推荐使用 Docker Compose 启动。宿主机只需要安装 Docker，不需要额外安装 Node.js、Python 或 PostgreSQL。

1. 复制配置文件：

```bash
cp .env.example .env
```

2. 修改 `.env`，至少配置：

```env
PORT=8787
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=your_base_url
GPT_IMAGE_MODEL=gpt-image-2
OPENAI_TEXT_MODEL=gpt-5.4
```

3. 启动：

```bash
docker compose up -d --build
```

4. 访问：

```text
http://localhost:8787
```

如果修改了 `.env` 里的 `PORT`，请访问对应端口。

### Docker 数据库说明

Docker Compose 内置 PostgreSQL 服务，后端通过 Compose 内网连接：

```text
postgres:5432
```

PostgreSQL 不会向宿主机暴露端口。`.env` 中的 `PORT` 只用于 Web/API 服务访问端口。

Compose 会创建两个命名卷：

- `image2_image_studio_postgres`：PostgreSQL 数据
- `image2_image_studio_data`：上传图片、生成图片等文件

停止服务：

```bash
docker compose down
```

清空 Docker 数据并重新开始：

```bash
docker compose down -v
```

## 本地开发启动

本地开发需要安装 Node.js 和 Python。

1. 安装前端依赖：

```bash
npm install
```

2. 安装 Python 依赖：

```bash
python -m pip install -r requirements.txt
```

3. 复制并修改配置：

```bash
cp .env.example .env
```

4. 启动开发服务：

```bash
npm run dev
```

默认访问：

```text
http://localhost:5173
```

后端会读取 `.env` 中的 `PORT`，默认监听：

```text
http://localhost:8787
```

Vite 开发服务器会自动把 `/api` 和 `/assets` 代理到后端端口。

## 生产方式启动

如果不使用 Docker，也可以手动构建前端并启动后端：

```bash
npm install
npm run build
python -m pip install -r requirements.txt
python -m server.run
```

后端会托管 `dist/client` 中的前端静态文件。

## 环境变量

配置文件为 `.env`，不要提交真实 `.env` 到 Git。

| 变量                              | 说明                               | 示例                                                     |
|---------------------------------|----------------------------------|--------------------------------------------------------|
| `PORT`                          | Web/API 服务端口                     | `8787`                                                 |
| `OPENAI_API_KEY`                | API 密钥                           | `sk-...`                                               |
| `OPENAI_BASE_URL`               | API Base URL                     | `https://utoken.club/v1`                               |
| `OPENAI_HTTP_TRUST_ENV`         | 图片请求是否读取系统代理环境变量，默认关闭            | `false`                                                |
| `GPT_IMAGE_MODEL`               | 图片模型                             | `gpt-image-2`                                          |
| `OPENAI_TEXT_MODEL`             | 文本对话模型                           | `gpt-5.4`                                              |
| `GOOGLE_CLIENT_ID`              | Google 登录 Client ID，可为空          | `xxx.apps.googleusercontent.com`                       |
| `DATA_DIR`                      | 本地数据目录                           | `./data`                                               |
| `DATABASE_URL`                  | 本地开发时连接 PostgreSQL；为空则使用 JSON 文件 | `postgresql://postgres:password@localhost:5432/image2` |
| `HISTORY_COMPRESSION_THRESHOLD` | 历史压缩阈值                           | `12000`                                                |
| `HISTORY_KEEP_RECENT`           | 压缩后保留最近消息数                       | `10`                                                   |

说明：

- Docker Compose 启动时，应用会使用 Compose 内网中的 PostgreSQL。
- 本地非 Docker 启动时，如果 `DATABASE_URL` 为空，会使用 `DATA_DIR/db.json` 作为本地存储。
- API Key、Base URL 和模型配置只在服务端使用，前端不会展示这些配置项。
- 图片请求默认不会读取系统代理环境变量，避免本机代理断开导致 `Server disconnected without sending a response`。如果确实需要使用系统代理，可以设置 `OPENAI_HTTP_TRUST_ENV=true`。

## 数据存储

### 未登录用户

未登录也可以使用应用。聊天历史会保存在浏览器本地存储中，刷新页面后仍可恢复。

### 登录用户

登录后历史会同步到服务端存储。用户之间通过账号区分历史消息。

### 本地 JSON 存储

未配置 `DATABASE_URL` 时，服务端数据保存在 `DATA_DIR` 中：

- `db.json`：用户、会话、消息、图片元数据
- `server-config.json`：服务端配置
- `images/`：上传图片和生成图片文件

### PostgreSQL 存储

配置 `DATABASE_URL` 后，服务端启动时会自动建表。主要表包括：

- `app_user`：用户
- `server_config`：服务端配置
- `chat_sessions`：会话和摘要
- `chat_messages`：消息和图片引用
- `image_assets`：图片元数据
- `image_blobs`：图片二进制源文件

图片文件也会同步保存到 `DATA_DIR/images`，用于浏览器静态访问。

## 常用命令

```bash
npm run dev
```

启动本地开发环境。

```bash
npm run build
```

构建前端生产包。

```bash
npm start
```

启动后端并托管已构建的前端。

```bash
docker compose up -d --build
```

使用 Docker Compose 构建并启动。

```bash
docker compose logs -f app
```

查看应用容器日志。

```bash
docker compose down
```

停止 Docker 服务。

## 项目结构

```text
.
├── client/              # React 前端源码
├── server/              # FastAPI 后端源码
├── data/                # 本地数据目录，默认不提交
├── dist/                # 前端构建产物，默认不提交
├── Dockerfile           # 应用镜像构建文件
├── docker-compose.yml   # Docker Compose 启动文件
├── DOCKER.md            # Docker 使用说明
├── package.json         # 前端和启动脚本
├── requirements.txt     # Python 依赖
└── .env.example         # 配置模板
```

## 常见问题

### 修改 `.env` 后端口没有变化

Docker 启动时需要重新创建容器：

```bash
docker compose up -d --build
```

本地开发时需要重启 `npm run dev`。

### 图片编辑接口返回 502

这通常表示 `OPENAI_BASE_URL` 对应的上游服务或代理在 `/images/edits` 接口上返回了网关错误。前端会正确进入图片编辑场景，但是否成功取决于上游服务是否支持对应接口。

### Docker 中怎么连接数据库

不需要在宿主机连接数据库。应用容器通过 Compose 内网访问 `postgres:5432`，数据库不暴露宿主机端口。

### 如何切换到本机 PostgreSQL

本地非 Docker 启动时，在 `.env` 中配置：

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/image2
```

Docker Compose 启动时默认使用内置 PostgreSQL。

## 安全提醒

- 不要提交 `.env`。
- 不要把真实 API Key 写入 README、前端代码或公开仓库。
- 生产环境建议使用反向代理和 HTTPS。
