---
sidebar_position: 6
---

# Logs

DaoFlow provides three layers of observability for deployments.

## Log Layers

| Layer                   | Description                         | Format          |
| ----------------------- | ----------------------------------- | --------------- |
| **Raw Logs**            | Exact stdout/stderr from containers | Plain text      |
| **Structured Timeline** | Deploy steps with status and timing | JSON events     |
| **Agent Summaries**     | AI-readable failure analysis        | Structured JSON |

## Viewing Logs

### Via CLI

```bash
# Recent logs
daoflow logs --deployment dep_abc123 --lines 50

# Search failed readiness checks across recent control-plane deployments
daoflow logs control-plane --query readiness --stream stderr --lines 25

# Specific deployment
daoflow logs --deployment dep_abc123 --json
```

### Via Dashboard

Navigate to **Deployments** → expand a deployment row to search persisted deployment logs. For
live container logs, use **Services** → **Logs**.

### Via API

```bash
GET /trpc/deploymentLogs?input={"json":{"deploymentId":"dep_abc123","query":"readiness","stream":"stderr"}}
```

## Log Entry Schema

```json
{
  "id": 1,
  "deploymentId": "dep_abc123",
  "level": "info",
  "message": "Container started successfully",
  "source": "runtime",
  "metadata": {},
  "createdAt": "2026-03-15T10:30:01Z"
}
```

| Field    | Values                           |
| -------- | -------------------------------- |
| `level`  | `debug`, `info`, `warn`, `error` |
| `source` | `build`, `runtime`, `system`     |

## Retention

- Raw logs are append-only and stored in PostgreSQL
- Structured events are normalized and queryable
- AI-generated summaries link back to exact log line IDs

## Required Scope

`logs:read`
