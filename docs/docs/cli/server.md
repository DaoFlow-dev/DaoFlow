---
sidebar_position: 8
---

# daoflow server add

Register a Docker target and collect untrusted SSH host-key material.

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
| `--ssh-key-id <id>`       | Reuse a managed SSH key asset              |
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
      "status": "pending host identity approval",
      "dockerVersion": null,
      "composeVersion": null
    }
  }
}
```

## Notes

- Registration collects public host-key observations but does not trust them or send SSH credentials.
- An owner or admin must approve the exact host-key algorithm, public key, and SHA-256 fingerprint
  in the dashboard before DaoFlow can perform any remote SSH or SCP operation.
- A changed host key blocks remote access. Rotation is an explicit owner/admin approval that records
  the old and new fingerprints in the audit trail.
- Raw SSH private keys are stored as managed SSH key assets and linked back to the server. Use
  `--ssh-key-id` to reuse an existing managed key instead of uploading private material again.
- If SSH works but Docker or Compose does not, the command returns structured issues and recommended actions instead of a silent partial success.
- Read-only principals still use [`daoflow status`](./status) and [`daoflow doctor`](./doctor) for inspection without mutation.
- `docker-swarm-manager` targets participate in Swarm stack deploy and rollback flows once a
  compose-backed service points at them.
- Swarm execution currently requires published-port readiness probes; internal-network probes still
  fail planning and execution.

## Server Operations

### Build And Queue Capacity

Each server starts with one active build slot and room for 20 queued deployments. Owners and
admins can change both values from the server's **Capacity** tab or the CLI:

```bash
daoflow server capacity \
  --server srv_123 \
  --max-concurrent-builds 1 \
  --max-queued-deployments 20 \
  --yes \
  --json
```

Use `--dry-run` to validate the payload without changing the server. Image pulls, image-only
deployments, health checks, and runtime restarts do not use build slots. Dockerfile, Compose,
Nixpacks, and Buildpack image builds do. When the queue is full, mutations fail with the stable
`DEPLOYMENT_QUEUE_FULL` code instead of silently overloading the host.

Build waiters stay counted after a worker claims them, acquire slots oldest-first, and expose their
queue position on the deployment page. Long context uploads renew their admission reservation while
streaming so a slow connection cannot silently lose its place before artifact persistence.

For a small VPS, keep `--max-concurrent-builds 1`. Raise it only after measuring memory, CPU, and
Docker disk pressure during representative application builds.

### Operational Commands

```bash
daoflow server ops resources --server srv_123 --json
daoflow server ops cleanup --server srv_123 --dry-run --json
daoflow server ops cleanup --server srv_123 --yes
daoflow server ops patch --server srv_123 --json
daoflow server ops swarm refresh-topology --server srv_123 --json
daoflow server ops swarm node availability --server srv_123 --node worker-a --availability drain --dry-run --json
daoflow server ops swarm service scale --server srv_123 --service stack_api --replicas 3 --dry-run --json
daoflow server ops history --server srv_123 --json
daoflow server ops logs --operation op_123 --json
```

Resource, history, and operation-log reads use `server:read`. Cleanup and patch commands use
`server:write`; live cleanup requires `--yes`. Swarm topology refresh, node availability changes,
and service scaling also use `server:write`; node and scale dry-runs create durable plan
operations, while live changes require `--yes`.

## Access Assets

Reusable SSH keys and custom certificates are managed through `daoflow access-assets`.

```bash
daoflow access-assets ssh-key list --json
daoflow access-assets ssh-key create --name prod-deploy --private-key-file ~/.ssh/daoflow_ed25519 --yes
daoflow access-assets ssh-key rotate --key-id key_123 --private-key-file ~/.ssh/daoflow_ed25519.new --yes
daoflow access-assets ssh-key attach --key-id key_123 --server-id srv_123 --yes
daoflow access-assets ssh-key detach --server-id srv_123 --yes
daoflow access-assets certificate list --json
daoflow access-assets certificate create --name wildcard-example --cert-file ./fullchain.pem --private-key-file ./privkey.pem --yes
```

List commands require `server:read`. Create, rotate, attach, and delete commands require
`server:write` and never print private key, certificate, or encrypted secret material.
