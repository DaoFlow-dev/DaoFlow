---
sidebar_position: 4
---

# daoflow status

Show the current status of servers, services, and deployments.

## Usage

```bash
daoflow status [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--server <name>` | Filter to a specific server |
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
  "servers": [
    {
      "name": "production-vps",
      "host": "203.0.113.10",
      "status": "connected",
      "dockerVersion": "24.0.7",
      "composeVersion": "2.23.0",
      "containerCount": 5,
      "lastHealthCheck": "2026-03-15T10:30:00Z",
      "latencyMs": 42
    }
  ],
  "recentDeployments": [
    {
      "id": "dep_abc123",
      "service": "my-app",
      "status": "completed",
      "conclusion": "succeeded",
      "createdAt": "2026-03-15T10:00:00Z"
    }
  ]
}
```
