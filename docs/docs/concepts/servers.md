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

Raw SSH private keys entered during server registration are moved into the managed SSH key
inventory and the server stores only the inventory reference. Operators can also pre-create a
managed key and reuse it across servers:

```bash
daoflow access-assets ssh-key create --name prod-deploy --private-key-file ~/.ssh/daoflow_ed25519 --yes
daoflow server add --name edge-vps-1 --host 203.0.113.42 --ssh-key-id key_123 --yes
daoflow access-assets ssh-key attach --key-id key_123 --server-id srv_123 --yes
daoflow access-assets ssh-key detach --server-id srv_123 --yes
```

The CLI registration flow returns the same readiness status, issues, and recommended actions that
the dashboard uses after registration.

For `docker-swarm-manager` targets, DaoFlow also persists a Swarm topology snapshot in server
metadata. DaoFlow uses that persisted topology to keep target kind and cluster context visible in
CLI and dashboard inspection flows, and compose-backed deploy or rollback execution now runs
through `docker stack` semantics on those managers.

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
- node membership with manager/worker roles, manager status, availability, and reachability
- safe summary counts for managers, workers, active nodes, and reachable nodes

Swarm management support:

- topology refresh reads `docker node ls --format json` from the manager and persists the observed snapshot
- node availability plans and updates use `docker node update --availability`
- service scale plans and updates use `docker service scale`
- compose-backed deploys and rollbacks use `docker stack`
- readiness must be probeable through published ports
- internal-network readiness probes remain unsupported for Swarm execution

## Server Operations Hub

Each server has an operations page at `/servers/:id`. The hub records every resource check,
cleanup preview, cleanup run, patch plan, and host terminal session as a durable server operation
with append-only logs.

### Resource Inspection

The resource check collects host CPU load, memory use, root disk use, Docker reachability, and
Docker disk usage. It creates a `resource_check` operation and stores the latest snapshot for the
server detail page.

```bash
daoflow server ops resources --server srv_prod --json
```

### Cleanup

Cleanup is preview-first. Operators must create a recent `cleanup_preview` before DaoFlow accepts a
`cleanup_run`. The run path only executes safe Docker prune commands by default:

- stopped containers
- dangling images
- build cache

Unused Docker volumes are excluded unless `--include-volumes` is supplied.

```bash
daoflow server ops cleanup --server srv_prod --dry-run --json
daoflow server ops cleanup --server srv_prod --yes
```

### Patch Planning

Patch planning is non-mutating. DaoFlow detects the host package manager where possible and records a
`patch_plan` operation with available package updates. Applying patches remains outside this flow.

```bash
daoflow server ops patch --server srv_prod --json
```

### Swarm Management

Swarm operations are recorded through the same durable operations hub. Refresh topology records the
observed manager and worker state. Node availability and service scale commands support `--dry-run`
for a recorded plan and require `--yes` for live changes.

```bash
daoflow server ops swarm refresh-topology --server srv_prod --json
daoflow server ops swarm node availability --server srv_prod --node worker-a --availability drain --dry-run --json
daoflow server ops swarm node availability --server srv_prod --node worker-a --availability drain --yes
daoflow server ops swarm service scale --server srv_prod --service stack_api --replicas 3 --dry-run --json
daoflow server ops swarm service scale --server srv_prod --service stack_api --replicas 3 --yes
```

### Host Terminal

Host terminal access is separate from service container terminals. The web UI opens host shells via
`/ws/host-terminal`, records `server.terminal.open` and `server.terminal.close`, and requires the
exceptional `terminal:open` scope.

## Managed Tunnels

Managed tunnels track external route providers separately from service domains. Operators can
register a tunnel, sync observed hostnames to services, rotate stored provider credentials, and
delete stale tunnel records from the dashboard or CLI.

```bash
daoflow tunnels list --json
daoflow tunnels create --name edge --domain app.example.com --yes
daoflow tunnels sync --tunnel-id tun_123 --route app.example.com=web:3000 --yes
```

Service-domain observation still works without managed tunnels. The tunnel inventory gives
operators a safer place to record what the external provider is currently exposing.

## Access Assets

The Settings operations tab includes reusable access assets:

- managed SSH keys with encrypted private key material, safe fingerprints, default SSH user
  metadata, rotation timestamps, and attach/delete actions
- custom certificate assets with encrypted certificate, private key, and CA chain material plus
  safe subject, issuer, expiration, domain, and fingerprint metadata

Read surfaces never return private keys, certificate bodies, or encrypted blobs. Write paths create
audit entries for create, rotate, attach, and delete actions. Managed SSH key rotation does not
expose the old key and future server connections resolve the latest encrypted key material through
the asset reference.

## Server Permissions

Access to server operations requires specific scopes:

| Action               | Required Scope  |
| -------------------- | --------------- |
| List servers         | `server:read`   |
| View server health   | `server:read`   |
| View operation logs  | `server:read`   |
| View managed tunnels | `server:read`   |
| View access assets   | `server:read`   |
| Register server      | `server:write`  |
| Update server config | `server:write`  |
| Cleanup and patching | `server:write`  |
| Manage Swarm         | `server:write`  |
| Manage tunnels       | `server:write`  |
| Manage access assets | `server:write`  |
| Open host terminal   | `terminal:open` |
| Remove server        | `server:write`  |
