# Image2 Studio

本地优先的 GPT Image 会话式生图与编辑工具。

## 功能

- 调用 OpenAI 图像接口生成图片，默认模型可配置为 `gpt-image-2`
- 多会话窗口，每个会话拥有独立上下文
- 默认会话名称为“未命名会话”
- 选择历史图片或上传图片作为编辑参考
- 本地保存会话、用户配置、原图、生成图与压缩后的上下文摘要
- 自动压缩长历史：完整消息保留在本地，发给模型的上下文使用摘要加最近消息
- 可选画质、尺寸、输出格式、压缩质量
- ChatGPT 风格响应式 UI，适配手机、平板和桌面浏览器

## 启动

```bash
npm install
python -m pip install -r requirements.txt
cp .env.example .env
npm run dev
```

前端默认打开 `http://localhost:5173`，Python 后端默认运行在 `http://localhost:8788`。

API Key、Base URL 和模型名只在服务端配置，不在前端页面展示。

## 数据目录

默认数据保存在 `data/`：

- `db.json`：会话、消息、图片资产和用户配置
- `server-config.json`：服务端 API 与模型配置，仅服务端使用
- `images/`：生成图片和上传原图

## PostgreSQL

默认使用本地 JSON。配置 `DATABASE_URL` 后会切换到 PostgreSQL，并在服务启动时自动建表。

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/image2
```

入库内容：

- `app_user`：本地用户
- `server_config`：API Key、Base URL、模型配置
- `chat_sessions`：会话与压缩摘要
- `chat_messages`：历史消息与图片引用
- `image_assets`：图片元数据
- `image_blobs`：图片源文件二进制

图片也会同步保存到 `DATA_DIR/images`，用于浏览器静态访问。

## 说明

OpenAI 官方文档中图像接口支持生成、编辑、画质、尺寸、格式和压缩参数。项目将图像模型名作为服务端配置项处理，所以可以直接使用你需要的 `gpt-image-2`，也可以按实际账号可用模型改成其他 GPT Image 模型。
