---
sidebar_position: 3
---

# Docker Compose Setup

The repository root `docker-compose.yml` is the production reference stack. Use it as-is unless you intentionally own the consequences of diverging from the shipped topology.

## What The Reference Stack Includes

The current production file starts:

- `daoflow` — web UI, API, and worker entrypoint
- `postgres` — DaoFlow application database (`pgvector/pgvector:pg17`)
- `redis` — streaming and transient coordination
- `temporal-postgresql`, `temporal`, `temporal-ui` — optional durable workflow substrate

The `daoflow` service also mounts:

- `/var/run/docker.sock` so the worker can execute local Docker and Compose operations
- `daoflow-staging` for frozen deploy artifacts
- `daoflow-ssh` for managed SSH key material

## Key Compose Excerpt

```yaml
services:
  daoflow:
    image: ghcr.io/daoflow-dev/daoflow:${DAOFLOW_VERSION:-latest}
    ports:
      - "${DAOFLOW_PORT:-3000}:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - daoflow-staging:/app/staging
      - daoflow-ssh:/app/.ssh
    environment:
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:3000}
      DAOFLOW_ENABLE_TEMPORAL: ${DAOFLOW_ENABLE_TEMPORAL:-false}
      TEMPORAL_ADDRESS: temporal:7233
      TEMPORAL_NAMESPACE: ${TEMPORAL_NAMESPACE:-daoflow}
      TEMPORAL_TASK_QUEUE: ${TEMPORAL_TASK_QUEUE:-daoflow-deployments}

  postgres:
    image: pgvector/pgvector:pg17

  redis:
    image: redis:7-alpine

  temporal-postgresql:
    image: postgres:15-alpine

  temporal:
    image: temporalio/auto-setup:latest
    environment:
      DEFAULT_NAMESPACE: ${TEMPORAL_NAMESPACE:-daoflow}

  temporal-ui:
    image: temporalio/ui:2.34.0
```

## Environment File

Start from the repository `.env.example` or let `daoflow install` generate it for you. The minimum production values are:

```bash
BETTER_AUTH_SECRET=generate-a-long-random-secret
ENCRYPTION_KEY=exactly-32-characters-long-key00
POSTGRES_PASSWORD=generate-a-secure-password
TEMPORAL_POSTGRES_PASSWORD=generate-another-secure-password
BETTER_AUTH_URL=https://deploy.example.com
DAOFLOW_VERSION=latest
DAOFLOW_PORT=3000
# DAOFLOW_ENABLE_TEMPORAL=false
```

Generate secure values:

```bash
openssl rand -hex 32  # BETTER_AUTH_SECRET
openssl rand -hex 16  # ENCRYPTION_KEY (32 hex chars)
openssl rand -hex 16  # POSTGRES_PASSWORD / TEMPORAL_POSTGRES_PASSWORD
```

## Startup

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f daoflow
```

## Health Check

```bash
curl http://127.0.0.1:3000/trpc/health
```

## Worker Mode Guidance

For a first staging rollout, keep `DAOFLOW_ENABLE_TEMPORAL=false` until:

- the core control-plane stack is healthy
- you have validated deploy, rollback, and backup flows
- the Temporal services are healthy and reachable

When you are ready to test durable orchestration, set:

```bash
DAOFLOW_ENABLE_TEMPORAL=true
```

The reference stack registers `${TEMPORAL_NAMESPACE:-daoflow}` during Temporal auto-setup so the app and worker can start workflows without manual namespace bootstrapping.

then restart the `daoflow` service with `docker compose up -d daoflow`.
