---
sidebar_position: 5
---

# Services

A service is the runtime unit in DaoFlow — a running container or set of containers managed by Docker Compose on a target server.

## Service Types

| Type                   | Description                               | Defined By                             |
| ---------------------- | ----------------------------------------- | -------------------------------------- |
| **Compose Service**    | Multi-container app from a `compose.yaml` | Docker Compose file                    |
| **Dockerfile Service** | Built from a Dockerfile in a Git repo     | Git URL + Dockerfile path              |
| **Image Service**      | Runs a pre-built Docker image             | Image reference (e.g., `nginx:alpine`) |

## Service Configuration

Each service stores:

- **Name** — unique identifier within the project
- **Source type** — compose, dockerfile, or image
- **Repository URL** — Git repo (for Dockerfile/Compose sources)
- **Compose path** — path to `compose.yaml` within the repo
- **Image tag** — specific image version to deploy
- **Environment variables** — key-value pairs (encrypted at rest)
- **Volume mounts** — persistent storage configuration
- **Port mappings** — exposed ports

## Service State

Services don't have runtime state tracked in the database — their state is determined by the latest deployment status:

| Deployment Status       | Service State     |
| ----------------------- | ----------------- |
| `completed` (succeeded) | Running / Healthy |
| `completed` (failed)    | Degraded          |
| `queued` / `deploy`     | Updating          |
| No deployments          | Not deployed      |

## Reachability and Links

DaoFlow now surfaces the most important operator-facing endpoints directly from the service read model:

- **Primary domain** when a custom hostname is configured
- **Additional domains** when the service exposes more than one route
- **Published ports** when the service maps a host port without a managed hostname

Each surfaced endpoint includes a state such as healthy, pending, failed, or unavailable so operators can tell whether the route is live, still coming online, misrouted, or simply not configured yet.

## Working with Services

```bash
# List all services
daoflow services --json

# View a specific service
daoflow services --name my-api --json

# Update service configuration
daoflow service update --name my-api --image my-api:v2 --yes
```

## Permissions

| Action                | Required Scope   |
| --------------------- | ---------------- |
| List services         | `service:read`   |
| View service config   | `service:read`   |
| Update service config | `service:update` |
