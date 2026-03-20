---
sidebar_position: 9
---

# daoflow doctor

Run connectivity and readiness diagnostics against the current DaoFlow control plane.

## Usage

```bash
daoflow doctor [options]
```

## Options

| Flag     | Description            |
| -------- | ---------------------- |
| `--json` | Structured JSON output |

## Required Scope

`server:read`, `logs:read`

## What It Checks

| Check                   | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| Configuration           | Current CLI context and target API                    |
| API connectivity        | Can reach the DaoFlow API                             |
| Authentication          | Token or session is configured                        |
| Server readiness poller | Configured polling interval and ready/attention mix   |
| Per-server diagnostics  | SSH, Docker, Compose, latency, last check, and issues |

## Examples

```bash
daoflow doctor --json
```

## JSON Output

```json
{
  "ok": true,
  "data": {
    "checks": [
      {
        "name": "Configuration",
        "status": "ok",
        "detail": "API URL: http://localhost:3000"
      },
      {
        "name": "API connectivity",
        "status": "ok",
        "detail": "Status: healthy | Service: daoflow-control-plane"
      },
      {
        "name": "Server readiness poller",
        "status": "ok",
        "detail": "Interval 60s | Ready 1/1"
      },
      {
        "name": "Server production-vps",
        "status": "ok",
        "detail": "203.0.113.10 | SSH ok | Docker 24.0.7 | Compose 2.23.0 | Checked 2026-03-20T22:29:30.000Z | Latency 42ms"
      }
    ],
    "summary": {
      "total": 4,
      "ok": 4,
      "warnings": 0,
      "failures": 0
    }
  }
}
```
