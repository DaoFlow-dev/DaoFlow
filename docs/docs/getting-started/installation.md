---
sidebar_position: 2
---

# Installation

This guide covers installing DaoFlow on your local machine for development, or on a server for production use.

## Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/daoflow/daoflow.git
cd daoflow
```

### 2. Install Dependencies

DaoFlow uses [Bun](https://bun.sh) as its package manager and runtime:

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install all workspace dependencies
bun install
```

### 3. Start Infrastructure

DaoFlow requires PostgreSQL 17 and Redis 7. The included `docker-compose.yml` starts both:

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5432` (user: `daoflow`, password: `daoflow_dev`, db: `daoflow`)
- **Redis** on port `6379`

### 4. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Key environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://daoflow:daoflow_dev@localhost:5432/daoflow` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `BETTER_AUTH_SECRET` | — | Secret for session signing (min 32 chars) |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Public URL of the auth server |
| `ENCRYPTION_KEY` | — | Key for encrypting secrets (exactly 32 chars) |

### 5. Run Migrations

```bash
bun run db:migrate
```

### 6. Start Development Server

```bash
bun run dev
```

This starts the API server and web dashboard on `http://localhost:3000`.

## Production Setup

For production deployments, see the [Self-Hosting guide](/docs/self-hosting).

### Production Docker Compose

```yaml
services:
  daoflow:
    image: ghcr.io/daoflow/daoflow:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://daoflow:SECURE_PASSWORD@db:5432/daoflow
      REDIS_URL: redis://redis:6379
      BETTER_AUTH_SECRET: your-production-secret-min-32-chars
      BETTER_AUTH_URL: https://your-domain.com
      ENCRYPTION_KEY: your-32-char-encryption-key-here
      NODE_ENV: production
    depends_on:
      - db
      - redis

  db:
    image: postgres:17-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: daoflow
      POSTGRES_PASSWORD: SECURE_PASSWORD
      POSTGRES_DB: daoflow

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

## Installing the CLI

The CLI can be installed globally:

```bash
# Via Bun
bun add -g @daoflow/cli

# Or build from source
cd packages/cli
bun run build
bun link
```

Verify the installation:

```bash
daoflow --version
daoflow --help
```

## Verifying Your Setup

Run the built-in health check:

```bash
# Via CLI
daoflow doctor --json

# Via API
curl http://localhost:3000/trpc/healthCheck
```

## Next Steps

- [Deploy your first application →](./first-deployment)
- [Configure your instance →](./configuration)
