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
2. Asks for your domain, admin email, and password
3. Creates `/opt/daoflow/` with `.env` and `docker-compose.yml`
4. Auto-generates all secrets (auth, encryption, database)
5. Pulls images, starts services, and verifies health

### Non-Interactive Install (CI / Agent-Friendly)

```bash
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --dir /opt/daoflow \
  --domain deploy.example.com \
  --email admin@example.com \
  --password 'YourSecurePassword123' \
  --yes
```

### What Gets Created

```
/opt/daoflow/              # All files in one directory
├── .env                   # All config + auto-generated secrets (0600 perms)
├── docker-compose.yml     # Standard Docker Compose — fully inspectable
└── backups/               # Local backup storage
```

The `.env` file contains everything — no hidden config:

```bash
DAOFLOW_VERSION=latest
BETTER_AUTH_URL=https://deploy.example.com
DAOFLOW_PORT=3000
DAOFLOW_INITIAL_ADMIN_EMAIL=admin@example.com
DAOFLOW_INITIAL_ADMIN_PASSWORD=GENERATED_OR_SUPPLIED_SECRET
POSTGRES_PASSWORD=GENERATED_32_CHAR_HEX
TEMPORAL_POSTGRES_PASSWORD=GENERATED_32_CHAR_HEX
BETTER_AUTH_SECRET=GENERATED_64_CHAR_HEX
ENCRYPTION_KEY=GENERATED_32_CHAR_HEX
DAOFLOW_ENABLE_TEMPORAL=true
TEMPORAL_ADDRESS=temporal:7233
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

## Installing the CLI Only

If you only need the CLI (not the server), download the binary for your platform:

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
daoflow --version
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

| Variable             | Default                                                   | Description                                                         |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`       | `postgresql://daoflow:daoflow_dev@localhost:5432/daoflow` | Postgres connection                                                 |
| `BETTER_AUTH_URL`    | `http://localhost:3000`                                   | Public auth URL                                                     |
| `BETTER_AUTH_SECRET` | optional locally                                          | Session signing secret (required in production)                     |
| `ENCRYPTION_KEY`     | optional locally                                          | Secret encryption key (recommended locally, required in production) |

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
