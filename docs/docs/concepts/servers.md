---
sidebar_position: 3
---

# Servers

Servers are the physical or virtual machines that DaoFlow deploys to. DaoFlow connects to servers over SSH and manages Docker containers remotely.

## Server Registration

### Via Dashboard

1. Navigate to **Servers** in the sidebar
2. Click **Add Server**
3. Enter: name, host IP, SSH port, and SSH key path
4. DaoFlow verifies connectivity and detects Docker/Compose versions

### Via CLI

```bash
daoflow server add \
  --name edge-vps-1 \
  --host 203.0.113.42 \
  --region us-west-2 \
  --ssh-user deploy \
  --ssh-key ~/.ssh/daoflow_ed25519 \
  --yes
```

The CLI registration flow returns the same readiness status, issues, and recommended actions that
the dashboard uses after registration.

For `docker-swarm-manager` targets, DaoFlow also persists a Swarm topology snapshot in server
metadata. The current post-MVP slice is inspection-oriented: the stored topology can describe the
manager, workers, cluster name, and namespace, but DaoFlow does not yet execute `docker stack`
rollouts from that model.

## Connectivity

DaoFlow uses SSH to connect to managed servers. Requirements:

- SSH access with key-based authentication
- Docker Engine 20.10+ installed
- Docker Compose v2+ installed
- User in the `docker` group (or sudo access)

### SSH Key Setup

```bash
# Generate a key pair for DaoFlow
ssh-keygen -t ed25519 -f ~/.ssh/daoflow_key -N ""

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/daoflow_key.pub user@your-server
```

## Health Checks

DaoFlow monitors server readiness with recurring checks:

| Check             | What It Verifies            |
| ----------------- | --------------------------- |
| SSH Connectivity  | Can connect over SSH        |
| Docker Available  | Docker daemon is running    |
| Compose Available | Docker Compose is installed |

Readiness checks run at a configurable interval using `SERVER_READINESS_POLL_INTERVAL_MS`
(default: `60000`).

### Checking Server Health

```bash
# Quick status
daoflow status --json

# Full diagnostics
daoflow doctor --json
```

```json
{
  "ok": true,
  "data": {
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
          "serverName": "production-vps",
          "serverHost": "203.0.113.10",
          "targetKind": "docker-engine",
          "swarmTopology": null,
          "sshReachable": true,
          "dockerVersion": "24.0.7",
          "composeVersion": "2.23.0",
          "checkedAt": "2026-03-20T22:29:30.000Z"
        }
      ]
    }
  }
}
```

When a target is a Swarm manager, `swarmTopology` exposes the persisted cluster snapshot:

- cluster identity (`clusterId`, `clusterName`)
- default namespace for future stack grouping
- node membership with manager/worker roles
- safe summary counts for managers, workers, active nodes, and reachable nodes

## Server Permissions

Access to server operations requires specific scopes:

| Action               | Required Scope |
| -------------------- | -------------- |
| List servers         | `server:read`  |
| View server health   | `server:read`  |
| Register server      | `server:write` |
| Update server config | `server:write` |
| Remove server        | `server:write` |
