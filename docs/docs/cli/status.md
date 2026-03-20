---
sidebar_position: 4
---

# daoflow status

Show the current control-plane health and persisted server readiness status.

## Usage

```bash
daoflow status [options]
```

## Options

| Flag     | Description            |
| -------- | ---------------------- |
| `--json` | Structured JSON output |

## Required Scope

`server:read`

## Examples

```bash
# Human-readable status
daoflow status

# JSON for agents
daoflow status --json
```

## JSON Output

```json
{
  "ok": true,
  "data": {
    "context": "local",
    "apiUrl": "http://localhost:3000",
    "health": {
      "status": "healthy",
      "service": "daoflow-control-plane",
      "timestamp": "2026-03-20T22:30:00.000Z"
    },
    "servers": {
      "summary": {
        "totalServers": 1,
        "readyServers": 1,
        "attentionServers": 0,
        "blockedServers": 0,
        "pollIntervalMs": 60000,
        "averageLatencyMs": 42
      },
      "checks": [
        {
          "serverId": "srv_prod",
          "serverName": "production-vps",
          "serverHost": "203.0.113.10",
          "targetKind": "docker-engine",
          "serverStatus": "ready",
          "readinessStatus": "ready",
          "statusTone": "healthy",
          "sshPort": 22,
          "sshReachable": true,
          "dockerReachable": true,
          "composeReachable": true,
          "dockerVersion": "24.0.7",
          "composeVersion": "2.23.0",
          "latencyMs": 42,
          "checkedAt": "2026-03-20T22:29:30.000Z",
          "issues": [],
          "recommendedActions": ["No action required."]
        }
      ]
    }
  }
}
```
