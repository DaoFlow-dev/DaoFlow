---
sidebar_position: 6
---

# daoflow logs

Fetch persisted deployment logs from the control plane.

## Usage

```bash
daoflow logs [options]
```

## Options

| Flag                | Description                    |
| ------------------- | ------------------------------ |
| `[service]`         | Filter recent logs by service  |
| `--deployment <id>` | Logs for a specific deployment |
| `--query <text>`    | Search within persisted logs   |
| `--stream <stream>` | `all`, `stdout`, or `stderr`   |
| `--follow`          | Reserved, not implemented yet  |
| `--lines <n>`       | Show last N lines              |
| `--json`            | Structured JSON output         |

## Required Scope

`logs:read`

## Examples

```bash
# View recent logs
daoflow logs --deployment dep_abc123 --lines 50

# Search failed readiness checks across recent control-plane deployments
daoflow logs control-plane --query readiness --stream stderr --lines 25

# JSON format for agent processing
daoflow logs --deployment dep_abc123 --json
```

## JSON Output

```json
{
  "ok": true,
  "data": {
    "service": "control-plane",
    "deploymentId": null,
    "query": "readiness",
    "stream": "stderr",
    "limit": 25,
    "summary": {
      "totalLines": 1,
      "stderrLines": 1,
      "deploymentCount": 1
    },
    "lines": [
      {
        "id": "log_foundation_failed_3",
        "deploymentId": "dep_foundation_20260311_1",
        "serviceName": "control-plane",
        "environmentName": "production-us-west",
        "stream": "stderr",
        "lineNumber": 3,
        "level": "error",
        "message": "Readiness endpoint /healthz returned 503 for 2 consecutive checks.",
        "createdAt": "2026-03-20T12:59:35.000Z"
      }
    ]
  }
}
```
