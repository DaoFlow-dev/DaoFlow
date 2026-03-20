---
sidebar_position: 7
---

# Deployment Lifecycle

Every deployment in DaoFlow follows a deterministic lifecycle with structured steps, audit records, and rollback points.

## State Machine

```
 ┌─────────┐    trigger    ┌──────────┐    dispatch    ┌─────────┐
 │  idle   │  ──────────▶  │  queued  │  ───────────▶  │ running │
 └─────────┘               └──────────┘               └─────────┘
                                │                          │
                           cancel│                    ┌────┴────┐
                                ▼                     ▼         ▼
                          ┌───────────┐         ┌─────────┐ ┌────────┐
                          │ cancelled │         │ healthy │ │ failed │
                          └───────────┘         └─────────┘ └────────┘
                                                      │
                                                 rollback
                                                      ▼
                                                ┌──────────┐
                                                │  queued  │ (new deployment)
                                                └──────────┘
```

## Deployment Steps

Each deployment is broken into structured steps for observability:

| Step      | Description                               | Timeline Position |
| --------- | ----------------------------------------- | ----------------- |
| `resolve` | Resolve service, environment, and server  | First             |
| `clone`   | Clone git repository (if git-based)       | After resolve     |
| `build`   | Build Docker image from Dockerfile        | After clone       |
| `pull`    | Pull image from registry (if image-based) | After resolve     |
| `volume`  | Create/verify named volumes               | Before start      |
| `start`   | Start containers via `docker compose up`  | Core step         |
| `health`  | Run health checks                         | After start       |
| `cleanup` | Remove old containers                     | After healthy     |

## Deployment Record

Every deployment produces an immutable record:

```json
{
  "id": "dep_abc123",
  "serviceName": "my-api",
  "status": "healthy",
  "sourceType": "compose",
  "commitSha": "a1b2c3d",
  "imageTag": "my-api:latest",
  "createdAt": "2026-03-17T05:00:00.000Z",
  "finishedAt": "2026-03-17T05:02:30.000Z",
  "steps": [
    { "step": "resolve", "status": "complete", "durationMs": 120 },
    { "step": "pull", "status": "complete", "durationMs": 3400 },
    { "step": "start", "status": "complete", "durationMs": 1200 },
    { "step": "health", "status": "complete", "durationMs": 5000 }
  ]
}
```

## Source Types

| Type         | Description                 | Input                      |
| ------------ | --------------------------- | -------------------------- |
| `image`      | Pull and run a Docker image | Image reference            |
| `dockerfile` | Build from Dockerfile       | Git repo + Dockerfile path |
| `compose`    | Docker Compose deployment   | compose.yaml file          |

## Rollback

Rollback targets the last known-healthy deployment:

```bash
# List rollback targets
daoflow rollback --service svc_my_api --json

# Preview rollback
daoflow rollback --service svc_my_api --target <id> --dry-run

# Execute rollback
daoflow rollback --service svc_my_api --target <id> --yes --json
```

A rollback creates a **new deployment record** that references the target deployment's configuration. It is not an undo — it is a forward deployment to a known-good state.

## Comparing Deployments

```bash
daoflow diff --a <baseline-id> --b <comparison-id> --json
```

Returns a scoped config diff showing project/environment/service metadata plus changes in commit, image, source type, status, and stored deployment snapshot fields.

## Cancelling Deployments

Only `queued` or `running` deployments can be cancelled:

```bash
daoflow cancel --deployment <id> --yes --json
```

Cancelled deployments transition to `failed` with conclusion `cancelled`.

## Audit Trail

Every deployment action produces an audit record:

- `deployment.create` — new deployment queued
- `deployment.dispatch` — deployment sent to worker
- `deployment.complete` — deployment finished (healthy/failed)
- `deployment.cancel` — deployment cancelled by user
- `deployment.rollback` — rollback initiated
