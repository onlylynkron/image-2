# Docker Compose

This project can run with Docker Compose without installing Node.js, Python, or PostgreSQL on the host.

## Configure

Edit `.env` before starting:

```env
PORT=8787
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://utoken.club/v1
GPT_IMAGE_MODEL=gpt-image-2
OPENAI_TEXT_MODEL=gpt-5.4

DOCKER_DATABASE_URL=postgresql://image_studio:image_studio@postgres:5432/image_studio
POSTGRES_DB=image_studio
POSTGRES_USER=image_studio
POSTGRES_PASSWORD=image_studio
```

`PORT` controls the web access port and the backend listening port inside Docker.

## Start

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:8787
```

If you change `PORT`, use the new port in the browser.

## Stop

```bash
docker compose down
```

## Data

Compose creates two named volumes:

- `image2_image_studio_postgres`: PostgreSQL data
- `image2_image_studio_data`: uploaded images and generated image files

To remove all Docker data for a fresh start:

```bash
docker compose down -v
```
