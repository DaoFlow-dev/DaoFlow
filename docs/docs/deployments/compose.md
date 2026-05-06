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
- Legacy `healthcheckPath` metadata is still stored for compatibility, but compose services should migrate to explicit `readinessProbe` configuration because `healthcheckPath` is not executed as a rollout gate.

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

## Git Provider Setup

Git-backed Compose projects can be attached to a registered provider during project creation.
Register the provider in Git settings, connect the installation or OAuth account, then create the
project from the setup wizard, the Projects page, or the CLI with:

- Git provider
- Git installation
- repository full name, such as `acme/api`
- default branch
- auto-deploy branch
- Compose path, such as `compose.yaml` or `deploy/compose.yaml`

For GitHub App projects, install the app into the target account, select that installation during
project creation, enable webhook auto-deploy when branch pushes should deploy automatically, and
configure preview behavior on the Compose service after the project exists. GitHub pull request
events then drive preview deploy and cleanup for preview-enabled services.

For GitLab.com, register a GitLab provider with the GitLab OAuth app client ID, client secret, and
webhook secret. The OAuth callback URL is:

```text
https://<daoflow-host>/settings/git/callback
```

The webhook URL is:

```text
https://<daoflow-host>/api/webhooks/gitlab
```

Set the GitLab webhook secret token to the same secret stored on the provider. Use push and merge
request events for auto-deploy and preview lifecycle automation.

For self-hosted GitLab, set the provider base URL to the root GitLab URL, for example
`https://gitlab.example.com`. Use the same callback URL and webhook URL shown above, but create the
OAuth application and webhook inside the self-hosted GitLab instance. DaoFlow uses the provider base
URL when exchanging OAuth codes, validating source access, and matching webhook project URLs, so the
same `group/project` path can exist safely on GitLab.com and a self-hosted GitLab host.

Preview config can also carry a retention window through `staleAfterHours`. When set, DaoFlow can compare the latest preview deployment state against observed tunnel-route hostnames and queue Compose preview cleanup for terminal preview stacks that outlive the configured window.

On the service detail page, the Environment tab now shows preview lifecycle state as a first-class operator surface:

- Preview mode, managed domain template, and cleanup retention policy
- Each tracked preview branch or pull request, including stack name and preview env branch
- Whether the preview is still live, drifted, or already due for cleanup
- Why DaoFlow is keeping the preview around and what event or action will remove it
- Manual preview retirement plus dry-run or live cleanup execution when the operator has deploy permissions

That UI keeps preview-specific cleanup isolated from the base environment, so clearing a preview does not flatten or mutate the long-lived environment configuration.
