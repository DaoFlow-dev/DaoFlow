---
sidebar_position: 9
---

# daoflow doctor

Run comprehensive diagnostics on your DaoFlow setup and connected servers.

## Usage

```bash
daoflow doctor [options]
```

## Options

| Flag              | Description             |
| ----------------- | ----------------------- |
| `--server <name>` | Check a specific server |
| `--json`          | Structured JSON output  |

## Required Scope

`server:read`, `logs:read`

## What It Checks

| Check            | Description                        |
| ---------------- | ---------------------------------- |
| API connectivity | Can reach the DaoFlow API          |
| Auth validity    | Token is valid and not expired     |
| Server SSH       | SSH connection to each server      |
| Docker daemon    | Docker is running on each server   |
| Docker Compose   | Compose is installed               |
| Disk space       | Warn if below 10% free             |
| Recent failures  | Any failed deployments in last 24h |

## Examples

```bash
daoflow doctor --json
```

## JSON Output

```json
{
  "ok": true,
  "checks": [
    {
      "name": "api_connectivity",
      "status": "pass",
      "detail": "Connected to http://localhost:3000"
    },
    { "name": "auth_valid", "status": "pass", "detail": "Token valid, role: admin" },
    { "name": "server_ssh", "server": "prod", "status": "pass", "latencyMs": 42 },
    { "name": "docker_available", "server": "prod", "status": "pass", "version": "24.0.7" },
    { "name": "disk_space", "server": "prod", "status": "warn", "freePercent": 8.5 }
  ]
}
```
