---
sidebar_position: 6
---

# daoflow logs

Stream or fetch logs from deployments and containers.

## Usage

```bash
daoflow logs [options]
```

## Options

| Flag                | Description                    |
| ------------------- | ------------------------------ |
| `--deployment <id>` | Logs for a specific deployment |
| `--follow`          | Stream logs in real-time       |
| `--lines <n>`       | Show last N lines              |
| `--json`            | Structured JSON output         |

## Required Scope

`logs:read`

## Examples

```bash
# View recent logs
daoflow logs --deployment dep_abc123 --lines 50

# Stream logs in real-time
daoflow logs --deployment dep_abc123 --follow

# JSON format for agent processing
daoflow logs --deployment dep_abc123 --json
```

## JSON Output

```json
{
  "ok": true,
  "logs": [
    {
      "timestamp": "2026-03-15T10:30:01Z",
      "level": "info",
      "message": "Server started on port 3000",
      "source": "runtime"
    }
  ]
}
```
