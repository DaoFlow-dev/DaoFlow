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

Today, server registration is handled in the dashboard or admin API. The CLI can read deployment and health state, but it does not yet expose a `daoflow server add` mutation.

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

DaoFlow monitors server health with periodic checks:

| Check             | What It Verifies            |
| ----------------- | --------------------------- |
| SSH Connectivity  | Can connect over SSH        |
| Docker Available  | Docker daemon is running    |
| Compose Available | Docker Compose is installed |
| Disk Space        | Available storage capacity  |
| Memory            | Available RAM               |
| CPU Load          | Current load average        |

Health checks run at a configurable interval (default: 60 seconds).

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
  "servers": [
    {
      "name": "production-vps",
      "host": "203.0.113.10",
      "sshConnected": true,
      "dockerVersion": "24.0.7",
      "composeVersion": "2.23.0",
      "lastHealthCheck": "2026-03-15T10:30:00Z"
    }
  ]
}
```

## Server Permissions

Access to server operations requires specific scopes:

| Action               | Required Scope |
| -------------------- | -------------- |
| List servers         | `server:read`  |
| View server health   | `server:read`  |
| Register server      | `server:write` |
| Update server config | `server:write` |
| Remove server        | `server:write` |
