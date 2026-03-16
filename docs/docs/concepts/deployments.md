---
sidebar_position: 4
---

# Deployments

A deployment represents a single attempt to release a version of a service to a target server. Every deployment creates an immutable record with full context.

## Deployment Lifecycle

```
queued → prepare → deploy → finalize → completed
                                    └→ failed
```

| Status | Description |
|--------|-------------|
| `queued` | Deployment requested, waiting to start |
| `prepare` | Pulling images, building, cloning repos |
| `deploy` | Running `docker compose up` or `docker run` |
| `finalize` | Health checks, post-deploy verification |
| `completed` | Successfully deployed |
| `failed` | Deployment failed at some step |

## Deployment Record

Every deployment records:

- **Input** — source type, image tag, commit SHA, compose file
- **Config snapshot** — resolved configuration at deploy time
- **Actor** — who requested it (user ID, email, role)
- **Trigger** — how it was initiated (`user`, `webhook`, `api`, `agent`)
- **Target** — which server and environment
- **Timestamps** — created, concluded
- **Outcome** — succeeded, failed, canceled, skipped
- **Steps** — structured timeline of what happened
- **Logs** — raw stdout/stderr from the deployment

## Deployment Sources

DaoFlow supports three deployment sources:

| Source | Description | Example |
|--------|-------------|---------|
| **Compose** | Docker Compose file | `--compose ./compose.yaml` |
| **Dockerfile** | Build from repository | `--repo https://github.com/org/app` |
| **Image** | Pre-built container image | `--image nginx:alpine` |

## Deployment Steps

Each deployment is broken into structured steps for clarity:

1. **Clone** — Clone git repository (if applicable)
2. **Build** — Build Docker image (if Dockerfile)
3. **Pull** — Pull container image
4. **Volume** — Create/verify named volumes
5. **Start** — Start containers
6. **Health** — Run health checks
7. **Finalize** — Mark deployment as complete

Each step has its own status, start time, and completion time.

## Permissions

| Action | Required Scope |
|--------|---------------|
| View deployment history | `deploy:read` |
| Start a deployment | `deploy:start` |
| Cancel a deployment | `deploy:cancel` |
| Rollback a deployment | `deploy:rollback` |
