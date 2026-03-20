---
sidebar_position: 2
---

# Compose Deployments

Docker Compose is the primary deployment method in DaoFlow. Compose files are first-class citizens — DaoFlow preserves both the original file and the rendered runtime spec.

## How It Works

1. You provide a `compose.yaml` file
2. DaoFlow uploads or checks out the deployment workspace on the target server
3. If the rendered Compose spec contains local `build:` services, DaoFlow builds them before start
4. Runs `docker compose up -d` with the appropriate project name
5. Waits for Docker Compose container state and Docker health
6. If configured, runs an explicit readiness probe from the deployment target host and records the outcome

## CLI Deployment

```bash
# Preview
daoflow deploy --compose ./compose.yaml --server srv_prod --dry-run

# Deploy
daoflow deploy --compose ./compose.yaml --server srv_prod --yes
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

Supported readiness probe shapes:

- HTTP against a host-published endpoint
- HTTP against the compose internal network for the targeted compose service
- TCP against a host-published port
- TCP against the compose internal network for the targeted compose service

Execution semantics are deterministic:

- DaoFlow probes from the deployment target host, not from the control plane browser session.
- `target: "published-port"` checks the configured host/port directly from that host.
- `target: "internal-network"` resolves the running compose container addresses for the targeted compose service and checks each running replica.
- Docker Compose container state and Docker health must pass before the readiness probe can promote the rollout.
- Remote HTTP probes need `curl` available so the worker can execute the probe over SSH from the host that is actually running the Compose project.
- Remote TCP probes use `bash` plus `timeout` on the target host to test raw socket connectivity.
- Legacy `healthcheckPath` metadata is still stored for compatibility, but explicit `readinessProbe` takes precedence for compose execution.

## Environment Variable Injection

DaoFlow injects environment variables from the project's environment configuration into the Compose file using `docker compose --env-file`:

```bash
daoflow env set --env-id env_prod_123 \
  --key DATABASE_URL \
  --value postgresql://... \
  --yes
```

These are then available in your `compose.yaml` via `${DATABASE_URL}`.

For git-backed Compose deployments, DaoFlow also generates a redacted shell export file so remote SSH execution sees the same resolved build/runtime environment surface as local execution. This is what allows Compose `build:` services and environment-backed BuildKit secret references to behave consistently on the target host without leaking secret values into logs or persisted plan artifacts.

## Preview Lifecycle Automation

Preview-enabled compose services can also reconcile preview stacks directly from provider webhooks when the project has webhook auto-deploy enabled:

- GitHub pull request `opened`, `synchronize`, and `reopened` events queue preview deploys.
- GitHub pull request `closed` events queue preview cleanup.
- GitLab merge request `open`, `update`, and `reopen` events queue preview deploys.
- GitLab merge request `merge` and `close` events queue preview cleanup.

DaoFlow records the resulting preview deploy, destroy, dedupe, and ignore outcomes in deployment history plus the event timeline so operators can trace why a preview stack changed state.

Preview config can also carry a retention window through `staleAfterHours`. When set, DaoFlow can compare the latest preview deployment state against observed tunnel-route hostnames and queue Compose preview cleanup for terminal preview stacks that outlive the configured window.
