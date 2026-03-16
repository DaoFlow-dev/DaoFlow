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

Non-interactive (CI / agent-friendly):

```bash
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --domain deploy.example.com \
  --email admin@example.com \
  --password 'YourSecurePassword123' \
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
daoflow --version
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

Requirements: **Bun 1.2+**, **Docker** with Compose v2.

```bash
git clone https://github.com/DaoFlow-dev/DaoFlow.git
cd DaoFlow
bun install
docker compose up -d          # Postgres 17 + Redis 7
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
bun test:unit                 # Vitest
bun test:e2e                  # Playwright
bun verify                    # All of the above
```

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

## Product Direction

The product charter for contributors and coding agents lives in [AGENTS.md](./AGENTS.md).
