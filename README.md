# DaoFlow

> The agentic platform to host deterministic systems — from one prompt to production.

Open-source Agentic DevOps System built for AI agents and humans. Deploy, inspect, diagnose, and rollback Docker Compose applications on your own VPS and bare-metal servers — safely and reliably.

- **Agent-first CLI** — structured JSON output, scoped permissions, dry-run previews
- **Three-lane API** — read, planning, and command lanes so agents observe without mutating
- **Docker Compose native** — first-class Compose deployments with immutable deployment records
- **Safe by default** — agents start read-only; destructive actions need explicit scopes and `--yes`
- **Full audit trail** — every mutation produces an immutable audit record
- **Persistent data** — named volumes, backup policies, S3-compatible storage, restore workflows

## Quick Start

### Production Install

```bash
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh
```

This downloads the `daoflow` CLI, checks Docker, and runs the interactive installer — creates `/opt/daoflow/` with `.env`, `docker-compose.yml`, and starts all services.

Re-running the script always refreshes the local `daoflow` binary before starting the installer.

Non-interactive (CI / agent-friendly):

```bash
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --domain deploy.example.com \
  --email admin@example.com \
  --password 'YourSecurePassword123' \
  --yes
```

Optional dashboard exposure during install:

```bash
# Tailnet-only HTTPS URL
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --email admin@example.com \
  --password 'YourSecurePassword123' \
  --expose tailscale-serve \
  --yes

# Public HTTPS URL via Tailscale Funnel
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --email admin@example.com \
  --password 'YourSecurePassword123' \
  --expose tailscale-funnel \
  --yes

# Public ephemeral URL via Cloudflare Quick Tunnel
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --email admin@example.com \
  --password 'YourSecurePassword123' \
  --expose cloudflare-quick \
  --yes
```

### CLI-Only Install

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

Verify:

```bash
daoflow --cli-version
daoflow whoami --json
```

## Current Stack

| Component   | Technology               |
| ----------- | ------------------------ |
| Runtime     | Bun                      |
| API Layer   | Hono + tRPC              |
| Auth        | Better Auth              |
| ORM         | Drizzle ORM              |
| Database    | PostgreSQL 17            |
| Cache/Queue | Redis 7                  |
| Web UI      | React + Vite + shadcn/ui |
| Testing     | Vitest + Playwright      |
| Packaging   | Docker multi-stage build |
| CI          | GitHub Actions           |

## Development

Requirements: **Bun 1.3.9** via the repo `packageManager` pin, **Docker** with Compose v2.

```bash
git clone https://github.com/DaoFlow-dev/DaoFlow.git
cd DaoFlow
bun install
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env
bun run db:migrate
bun run dev
```

- API server: `http://localhost:3000`
- Vite web UI: `http://localhost:5173`

Auth notes:

- `BETTER_AUTH_SECRET` is optional locally, required in production
- `BETTER_AUTH_URL` must match the externally reachable origin in production
- First account created becomes `owner`; subsequent sign-ups default to `viewer`

## Quality Gates

```bash
bun lint                      # ESLint
bun typecheck                 # TypeScript
bun test:unit                 # Unit tests
bun test:e2e                  # Playwright
bun verify                    # All of the above
```

`bun run test:e2e` reuses `docker-compose.dev.yml` for Postgres, Redis, and Temporal, then runs the E2E-specific DB reset/seed setup scripts before Playwright starts the app on the host.

## Production Build

```bash
bun run build                 # Build client + server
bun start                     # Start production server
```

Docker:

```bash
docker build -t daoflow:local .
docker run --rm -p 3000:3000 \
  -e BETTER_AUTH_SECRET=replace-with-a-long-random-secret \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  daoflow:local
```

## Documentation

Full docs at [**daoflow-dev.github.io/DaoFlow**](https://daoflow-dev.github.io/DaoFlow/).

| Topic                                                                             | Description                               |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| [Getting Started](https://daoflow-dev.github.io/DaoFlow/docs/)                    | Install, configure, deploy your first app |
| [Vision & Principles](https://daoflow-dev.github.io/DaoFlow/docs/concepts/vision) | Why DaoFlow — open-source philosophy      |
| [CLI Reference](https://daoflow-dev.github.io/DaoFlow/docs/cli)                   | Every command, flag, and exit code        |
| [Comparisons](https://daoflow-dev.github.io/DaoFlow/docs/comparisons)             | vs Vercel, Coolify, Dokploy, AWS, Kamal   |
| [Agent Integration](https://daoflow-dev.github.io/DaoFlow/docs/agents)            | Using DaoFlow with AI coding agents       |
| [Security & RBAC](https://daoflow-dev.github.io/DaoFlow/docs/security)            | Roles, scopes, tokens, audit              |

## Product Direction

The product charter for contributors and coding agents lives in [AGENTS.md](./AGENTS.md).

## License

MIT
