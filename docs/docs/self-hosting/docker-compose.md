---
sidebar_position: 3
---

# Docker Compose Setup

The recommended way to deploy DaoFlow in production.

## Production Compose File

```yaml
version: "3.8"

services:
  daoflow:
    image: ghcr.io/daoflow-dev/daoflow:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://daoflow:${POSTGRES_PASSWORD}@db:5432/daoflow
      REDIS_URL: redis://redis:6379
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  db:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: daoflow
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: daoflow
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U daoflow"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
  redisdata:
```

## Environment File

Create a `.env` file alongside your `compose.yaml`:

```bash
POSTGRES_PASSWORD=generate-a-secure-password-here
BETTER_AUTH_SECRET=generate-a-32-char-secret-here-minimum
BETTER_AUTH_URL=https://your-domain.com
ENCRYPTION_KEY=exactly-32-characters-long-key00
```

Generate secure values:

```bash
openssl rand -hex 32  # For BETTER_AUTH_SECRET
openssl rand -hex 16  # For POSTGRES_PASSWORD
openssl rand -hex 16  # For ENCRYPTION_KEY (take first 32 chars)
```

## Startup

```bash
docker compose up -d
docker compose logs -f daoflow
```

## Health Check

```bash
curl http://localhost:3000/trpc/healthCheck
```
