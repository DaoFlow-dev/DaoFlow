---
sidebar_position: 8
---

# daoflow server add

Register a Docker target and run readiness verification immediately.

## Usage

```bash
daoflow server add [options]
```

## Required Scope

- `server:write`

## Options

| Flag                      | Description                                |
| ------------------------- | ------------------------------------------ |
| `--name <name>`           | Stable server name                         |
| `--host <host>`           | Hostname or IP address                     |
| `--region <region>`       | Region label, defaults to `default`        |
| `--ssh-port <port>`       | SSH port, defaults to `22`                 |
| `--ssh-user <user>`       | SSH user, defaults to `root`               |
| `--ssh-key <path>`        | Path to an SSH private key file            |
| `--ssh-private-key <pem>` | Inline SSH private key material            |
| `--kind <kind>`           | `docker-engine` or `docker-swarm-manager`  |
| `--dry-run`               | Preview the payload and exit with code `3` |
| `--yes`                   | Confirm the registration                   |
| `--json`                  | Emit the standard JSON envelope            |

## Examples

```bash
daoflow server add \
  --name edge-vps-1 \
  --host 203.0.113.42 \
  --region us-west-2 \
  --ssh-user deploy \
  --ssh-key ~/.ssh/daoflow_ed25519 \
  --yes
```

```bash
daoflow server add \
  --name local-dev \
  --host localhost \
  --region local \
  --yes \
  --json
```

## JSON Success Shape

```json
{
  "ok": true,
  "data": {
    "server": {
      "id": "srv_edge_vps_1",
      "name": "edge-vps-1",
      "host": "203.0.113.42",
      "region": "us-west-2",
      "sshPort": 22,
      "sshUser": "deploy",
      "kind": "docker-engine",
      "status": "ready",
      "dockerVersion": "27.5.1",
      "composeVersion": "2.34.0"
    },
    "readiness": {
      "readinessStatus": "ready",
      "sshReachable": true,
      "dockerReachable": true,
      "composeReachable": true,
      "latencyMs": 42,
      "checkedAt": "2026-03-20T22:05:00.000Z",
      "issues": [],
      "recommendedActions": ["No action required."]
    }
  }
}
```

## Notes

- Registration immediately runs the same readiness verification flow used by the dashboard.
- If SSH works but Docker or Compose does not, the command returns structured issues and recommended actions instead of a silent partial success.
- Read-only principals still use [`daoflow status`](./status) and [`daoflow doctor`](./doctor) for inspection without mutation.
- `docker-swarm-manager` currently covers target registration plus readiness inspection only. Swarm
  stack deploy and rollback semantics remain a separate follow-up track.
