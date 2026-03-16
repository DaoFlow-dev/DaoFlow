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

| Flag                | Description                                       |
| ------------------- | ------------------------------------------------- |
| `--deployment <id>` | Logs for a specific deployment                    |
| `--service <name>`  | Logs for a service (latest deployment)            |
| `--level <level>`   | Filter by level: `debug`, `info`, `warn`, `error` |
| `--follow` / `-f`   | Stream logs in real-time                          |
| `--tail <n>`        | Show last N lines (default: 100)                  |
| `--json`            | Structured JSON output                            |

## Required Scope

`logs:read`

## Examples

```bash
# View recent logs
daoflow logs --service my-app --tail 50

# Stream logs in real-time
daoflow logs --service my-app --follow

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
