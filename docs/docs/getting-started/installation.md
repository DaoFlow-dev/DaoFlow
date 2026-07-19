---
sidebar_position: 2
---

# Installation

DaoFlow installs in one command. It's just a normal Docker Compose project on your server — no vendor lock-in, no hacks.

## Production Install (Recommended)

### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh
```

This downloads the `daoflow` CLI binary and runs the interactive installer, which:

1. Checks Docker is installed (installs it on Linux if needed)
2. Asks for your domain, workflow profile, dashboard exposure mode, admin email, and password
3. Creates `/opt/daoflow/` with `.env` and `docker-compose.yml`
4. Auto-generates all secrets (auth, encryption, database)
5. Pulls images, starts services, and verifies startup readiness

Re-running the install script always refreshes the local `daoflow` CLI binary before the installer starts.

### Non-Interactive Install (CI / Agent-Friendly)

```bash
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --dir /opt/daoflow \
  --domain deploy.example.com \
  --email admin@example.com \
  --password 'YourSecurePassword123' \
  --yes
```

The default workflow profile is lean. To explicitly install the durable Temporal workflow
services, add `--workflow-profile temporal`:

```bash
daoflow install \
  --dir /opt/daoflow \
  --domain deploy.example.com \
  --email admin@example.com \
  --password 'YourSecurePassword123' \
  --workflow-profile temporal \
  --yes
```

### Workflow Profiles

`--workflow-profile <lean|temporal>` controls which local services are started:

| Profile          | Services started                                            | Persisted settings                                                                                            |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lean` (default) | `daoflow`, `postgres`, and `redis` only                     | `DAOFLOW_WORKFLOW_PROFILE=lean`, `COMPOSE_PROFILES=` (no active profile), and `DAOFLOW_ENABLE_TEMPORAL=false` |
| `temporal`       | The lean services plus `temporal-postgresql` and `temporal` | `DAOFLOW_WORKFLOW_PROFILE=temporal`, `COMPOSE_PROFILES=temporal`, and `DAOFLOW_ENABLE_TEMPORAL=true`          |

Lean can omit `TEMPORAL_POSTGRES_PASSWORD`. A temporal install requires a non-empty
`TEMPORAL_POSTGRES_PASSWORD` for the Temporal database.

The Temporal UI is a separate opt-in Compose profile. Selecting the temporal workflow profile does
not start the dashboard; start it only when needed with the instructions in
[Docker Compose Setup](/docs/self-hosting/docker-compose).

When you rerun the installer for an existing directory without supplying a profile, it preserves
the current workflow choice. It reads the persisted profile when available and infers the choice
from the existing Temporal settings for older installs. If you request `temporal` to `lean`, the
installer explains the transition plan before mutation, stops and removes the Temporal containers,
and keeps the `temporal-pgdata` named volume. Do not use `docker compose down -v` for this switch.

### Optional Dashboard Exposure

The installer can also set `BETTER_AUTH_URL` from an exposed HTTPS endpoint after the stack starts:

```bash
# Built-in reverse proxy with automatic Let's Encrypt certificates
daoflow install --domain deploy.example.com --expose traefik --acme-email ops@example.com

# Tailnet-only HTTPS URL
daoflow install --expose tailscale-serve

# Public HTTPS URL
daoflow install --expose tailscale-funnel

# Public ephemeral trycloudflare.com URL
daoflow install --expose cloudflare-quick
```

Requirements:

- `traefik` requires a real public domain that already points at this host. The installer keeps DaoFlow on its local port and puts Traefik on ports 80/443.
- `tailscale-serve` and `tailscale-funnel` require `tailscale` to already be installed and authenticated on the host.
- `cloudflare-quick` requires `cloudflared` to already be installed on the host.
- `cloudflare-quick` is best for temporary access, demos, and smoke tests; the URL is ephemeral.

### What Gets Created

```
/opt/daoflow/              # All files in one directory
├── .env                   # All config + auto-generated secrets (0600 perms)
├── docker-compose.yml     # Standard Docker Compose — fully inspectable
└── backups/               # Local backup storage
```

The `.env` file contains everything — no hidden config:

```bash
DAOFLOW_VERSION=0.11.0
BETTER_AUTH_URL=https://deploy.example.com
DAOFLOW_PORT=3000
DAOFLOW_INITIAL_ADMIN_EMAIL=admin@example.com
DAOFLOW_INITIAL_ADMIN_PASSWORD=GENERATED_OR_SUPPLIED_SECRET
POSTGRES_PASSWORD=GENERATED_48_CHAR_HEX
# TEMPORAL_POSTGRES_PASSWORD=GENERATED_48_CHAR_HEX  # temporal profile only
BETTER_AUTH_SECRET=GENERATED_64_CHAR_HEX
ENCRYPTION_KEY=GENERATED_32_CHAR_HEX
DAOFLOW_WORKFLOW_PROFILE=lean
COMPOSE_PROFILES=
DAOFLOW_ENABLE_TEMPORAL=false
# TEMPORAL_ADDRESS=temporal:7233
```

For a temporal install, the generated profile settings are instead:

```bash
DAOFLOW_WORKFLOW_PROFILE=temporal
COMPOSE_PROFILES=temporal
DAOFLOW_ENABLE_TEMPORAL=true
TEMPORAL_POSTGRES_PASSWORD=GENERATED_48_CHAR_HEX
TEMPORAL_ADDRESS=temporal:7233
```

The installer writes the concrete DaoFlow version into `.env` so production installs do not silently track a floating image tag. Change `DAOFLOW_VERSION` only when you intentionally upgrade or roll back.

When you choose `--expose traefik`, the installer also writes:

```bash
DAOFLOW_DOMAIN=deploy.example.com
DAOFLOW_ACME_EMAIL=ops@example.com
DAOFLOW_PROXY_NETWORK=daoflow-proxy
```

### Upgrading

```bash
# Upgrade to latest
daoflow upgrade --yes

# Pin to a specific version
daoflow upgrade --version 0.2.0 --yes

# JSON output for agents
daoflow upgrade --yes --json
```

### Uninstalling

```bash
# Stop services (preserves data)
daoflow uninstall --yes

# Stop + remove all data (requires typing DELETE)
daoflow uninstall --remove-data --yes
```

Stopping services does not remove the database or other named volumes. Back up data before
upgrades or profile changes, and use `--remove-data` only when permanent data removal is intended.

## Installing the CLI Only

If you only need the CLI (not the server):

### Homebrew (macOS)

```bash
brew install daoflow-dev/daoflow/daoflow
```

To upgrade:

```bash
brew upgrade daoflow
```

### Direct Binary Download

Download the binary for your platform:

```bash
# macOS (Apple Silicon)
curl -fsSL -o /usr/local/bin/daoflow \
  https://github.com/DaoFlow-dev/DaoFlow/releases/latest/download/daoflow-darwin-arm64
chmod +x /usr/local/bin/daoflow

# Linux (x64)
curl -fsSL -o /usr/local/bin/daoflow \
  https://github.com/DaoFlow-dev/DaoFlow/releases/latest/download/daoflow-linux-x64
chmod +x /usr/local/bin/daoflow
```

Or build from source:

```bash
cd packages/cli
bun run build          # Current platform
bun run build:all      # All 4 platforms (linux-x64, linux-arm64, darwin-arm64, darwin-x64)
```

Verify:

```bash
daoflow --cli-version
daoflow --help
```

## Development Setup

For contributing to DaoFlow itself:

### 1. Clone and Install

```bash
git clone https://github.com/DaoFlow-dev/DaoFlow.git
cd DaoFlow
bun install
```

### 2. Start Infrastructure

```bash
bun run dev:infra

# Optional second terminal if you want durable Temporal-backed workflows locally
bun run dev:temporal
```

This starts PostgreSQL 17 (port 5432) and Redis 7 (port 6379). Temporal remains optional in local development unless you explicitly start it.

### 3. Configure

```bash
cp .env.example .env
```

Key variables:

| Variable             | Default                                                   | Description                                                 |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`       | `postgresql://daoflow:daoflow_dev@localhost:5432/daoflow` | Postgres connection                                         |
| `BETTER_AUTH_URL`    | `http://localhost:3000`                                   | Public auth URL                                             |
| `BETTER_AUTH_SECRET` | optional locally                                          | Session signing secret (required in production)             |
| `ENCRYPTION_KEY`     | optional locally                                          | Secret encryption key, at least 32 characters in production |

### 4. Migrate and Run

```bash
bun run db:push
bun run dev
```

Local endpoints:

- API server: `http://localhost:3000`
- Vite web UI: `http://localhost:5173`

## Verifying Your Setup

```bash
# CLI health check
daoflow doctor --json

# API health check
curl http://localhost:3000/trpc/health
```

## Next Steps

- [Deploy your first application →](./first-deployment)
- [Configure your instance →](./configuration)
- [Rehearse a staging rollout →](/docs/self-hosting/staging-runbook)
- [Set up SSL & domains →](/docs/self-hosting/ssl-and-domains)
