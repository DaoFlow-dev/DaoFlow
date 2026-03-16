---
sidebar_position: 1
---

# Deployments

DaoFlow supports three deployment sources: Docker Compose, Dockerfile, and pre-built images. All deployments create immutable records with full context for auditability and rollback.

## Deployment Sources

| Source                     | Best For             | Input                  |
| -------------------------- | -------------------- | ---------------------- |
| [Compose](./compose)       | Multi-service apps   | `compose.yaml` file    |
| [Dockerfile](./dockerfile) | Build from source    | Git repo + Dockerfile  |
| [Image](./image)           | Pre-built containers | Docker image reference |

## Deployment Lifecycle

Every deployment follows the same lifecycle regardless of source:

```
queued → prepare → deploy → finalize → completed/failed
```

See [Core Concepts: Deployments](/docs/concepts/deployments) for the full lifecycle model.

## Key Features

- **Immutable records** — every deployment preserves input, config, actor, and outcome
- **Structured steps** — each phase has its own status and timing
- **Rollback support** — target any previous successful deployment
- **Dry-run preview** — see what would happen without executing
- **Idempotency keys** — prevent duplicate deployments
- **Raw + structured logs** — both stdout/stderr and parsed event timeline

## Related

- [Rollback](./rollback) — rolling back deployments
- [Logs](./logs) — viewing deployment and container logs
