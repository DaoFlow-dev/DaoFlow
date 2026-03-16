---
sidebar_position: 2
---

# Compose Deployments

Docker Compose is the primary deployment method in DaoFlow. Compose files are first-class citizens — DaoFlow preserves both the original file and the rendered runtime spec.

## How It Works

1. You provide a `compose.yaml` file
2. DaoFlow uploads it to the target server
3. Runs `docker compose up -d` with the appropriate project name
4. Monitors health and records the outcome

## CLI Deployment

```bash
# Preview
daoflow deploy --service my-app --server prod --compose ./compose.yaml --dry-run

# Deploy
daoflow deploy --service my-app --server prod --compose ./compose.yaml --yes
```

## Example Compose File

```yaml
services:
  web:
    image: node:20-alpine
    command: npm start
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
    volumes:
      - app-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  app-data:
  redis-data:
```

## What DaoFlow Stores

For each Compose deployment, DaoFlow records:

- **Original compose.yaml** — the file as provided
- **Resolved config** — with environment variables substituted
- **Image tags** — exact versions pulled
- **Volume mounts** — persistent storage configuration
- **Environment variables** — encrypted values used at deploy time

## Multi-Service Support

Compose files with multiple services are deployed as a unit. All services start together, and the deployment is marked as successful only when all services are healthy.

## Environment Variable Injection

DaoFlow injects environment variables from the project's environment configuration into the Compose file using `docker compose --env-file`:

```bash
daoflow env set --project my-app --env production \
  DATABASE_URL=postgresql://... --yes
```

These are then available in your `compose.yaml` via `${DATABASE_URL}`.
