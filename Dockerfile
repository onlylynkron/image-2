FROM node:22-bookworm AS frontend

WORKDIR /app
COPY package.json package-lock.json tsconfig.json vite.config.ts index.html ./
COPY client ./client
RUN npm ci
RUN npm run build:client

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8787

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server ./server
COPY --from=frontend /app/dist ./dist

RUN mkdir -p /app/data/images

EXPOSE 8787

CMD ["python", "-m", "server.run"]
