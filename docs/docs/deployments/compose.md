---
sidebar_position: 2
---

# Compose Deployments

Docker Compose is the primary deployment method in DaoFlow. Compose files are first-class citizens — DaoFlow preserves both the original file and the rendered runtime spec.

## How It Works

1. You provide a `compose.yaml` file
2. DaoFlow uploads it to the target server
3. Runs `docker compose up -d` with the appropriate project name
4. Waits for Docker Compose container state and Docker health
5. If configured, runs an explicit readiness probe from the deployment target host and records the outcome

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

## Explicit Readiness Probes

Compose deployments can opt into an explicit readiness probe on the DaoFlow service definition:

```json
{
  "readinessProbe": {
    "type": "http",
    "target": "published-port",
    "port": 8080,
    "path": "/ready",
    "host": "127.0.0.1",
    "scheme": "http",
    "timeoutSeconds": 60,
    "intervalSeconds": 3,
    "successStatusCodes": [200, 204]
  }
}
```

Current semantics are intentionally narrow and deterministic:

- DaoFlow probes a published port from the deployment target host, not from the control plane browser session.
- Docker Compose container state and Docker health must pass before the readiness probe can promote the rollout.
- Remote Docker targets need `curl` available so the worker can execute the probe over SSH from the host that is actually running the Compose project.
- Legacy `healthcheckPath` metadata is still stored for compatibility, but explicit `readinessProbe` takes precedence for compose execution.

## Environment Variable Injection

DaoFlow injects environment variables from the project's environment configuration into the Compose file using `docker compose --env-file`:

```bash
daoflow env set --project my-app --env production \
  DATABASE_URL=postgresql://... --yes
```

These are then available in your `compose.yaml` via `${DATABASE_URL}`.
