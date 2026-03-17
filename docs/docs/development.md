# Local Development Guide

This guide covers setting up DaoFlow for local development, testing the CLI, and running the Next.js example app.

## Prerequisites

- [Bun](https://bun.sh/) v1.3+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for macOS
- Git

## 1. Clone and Install

```bash
git clone https://github.com/DaoFlow-dev/DaoFlow.git
cd DaoFlow
bun install
```

## 2. Start Infrastructure

DaoFlow uses Postgres, Redis, and Temporal for local development. All are containerized:

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts:

| Service              | Port  | Description                          |
|----------------------|-------|--------------------------------------|
| `postgres`           | 5432  | DaoFlow primary database (pgvector)  |
| `redis`              | 6379  | Background job queue + SSE streaming |
| `temporal-postgresql`| —     | Temporal's own Postgres instance     |
| `temporal`           | 7233  | Temporal workflow engine             |
| `temporal-ui`        | 8233  | Temporal web dashboard               |

> **Note:** Temporal auto-setup takes 2–3 minutes on first boot (schema migrations). Check with `docker logs daoflow-temporal-1 -f`.

Verify everything is healthy:

```bash
docker compose -f docker-compose.dev.yml ps
```

## 3. Initialize the Database

Push the Drizzle schema to Postgres:

```bash
bun run db:push
```

## 4. Start the Development Server

```bash
bun run dev
```

The DaoFlow server runs at `http://localhost:3000`.

## 5. Create a Test User

Open `http://localhost:3000` in a browser and sign up with an email and password. The first user gets the `owner` role.

---

## Testing the CLI Locally

### Build the CLI

The CLI uses bun workspace to share types with the server via `@daoflow/server/router`:

```bash
bun build packages/cli/src/index.ts --outfile dist/daoflow --target bun
```

### Login

```bash
# Sign in with email/password (captures session cookie from Better Auth)
bun dist/daoflow login http://localhost:3000 --email you@example.com --password yourpassword
```

### Run Commands

```bash
# Identity & permissions
bun dist/daoflow whoami --json
bun dist/daoflow capabilities --json

# Infrastructure health
bun dist/daoflow status --json
bun dist/daoflow doctor --json

# Services & projects
bun dist/daoflow services --json
bun dist/daoflow projects list --json

# Deployment (dry-run, exit code 3)
bun dist/daoflow deploy --service my-svc --dry-run --json

# Backups
bun dist/daoflow backup list --json
bun dist/daoflow backup run --policy-id <id> --dry-run
bun dist/daoflow backup restore --backup-run-id <id> --dry-run
```

### Develop Without Rebuilding

During active CLI development, run directly from source with `bun run`:

```bash
bun run packages/cli/src/index.ts whoami --json
bun run packages/cli/src/index.ts services --json
```

This uses bun's native TypeScript execution — no build step needed. Changes to CLI source files take effect immediately.

### tRPC Type Safety

The CLI uses a vanilla `@trpc/client` with the shared `AppRouter` type from the server:

```
@daoflow/server/router  ──→  exports AppRouter type
       ↓ (bun workspace:*)
packages/cli/src/trpc-client.ts  ──→  createTRPCClient<AppRouter>
       ↓
All CLI commands  ──→  trpc.*.query() / trpc.*.mutate()
```

If you add a new tRPC procedure on the server, the CLI gets full type inference automatically.

---

## Testing the Example App

### Next.js Example

The repo includes a ready-to-deploy Next.js app:

```bash
cd examples/nextjs-daoflow-example

# Install dependencies
bun install

# Run locally (port 3001)
bun run dev
```

Open `http://localhost:3001` to verify the app works.

### Build and Run with Docker

```bash
cd examples/nextjs-daoflow-example

# Build the Docker image
docker build -t nextjs-daoflow-example .

# Run it
docker run -p 3001:3000 nextjs-daoflow-example
```

### Deploy via CLI (to local DaoFlow)

```bash
# Service deploy (dry-run first)
bun dist/daoflow deploy --service nextjs-example --dry-run --json

# When ready (requires deploy:start scope)
bun dist/daoflow deploy --service nextjs-example --yes
```

### Compose Deploy with Local Context

For projects using Docker Compose with `build.context: .`, use the compose deploy flow:

```bash
cd examples/nextjs-docker-compose-example

# Preview the deployment plan
bun dist/daoflow deploy --compose ./compose.yaml --server my-server --dry-run

# Execute
bun dist/daoflow deploy --compose ./compose.yaml --server my-server --yes
```

DaoFlow bundles the local directory as tar.gz, uploads it to the server, which SCP's it to your target server and builds remotely.

#### Ignore Files

DaoFlow respects **both** `.dockerignore` and `.daoflowignore`:

| File | Purpose |
|------|---------|
| `.dockerignore` | Standard Docker ignore rules (e.g., `node_modules`, `.git`) |
| `.daoflowignore` | DaoFlow-specific overrides — lines starting with `!` force-include files excluded by `.dockerignore` (e.g., `!.env`) |

Both files are applied in order: `.dockerignore` first, then `.daoflowignore` as additive overrides.

#### Configuration (daoflow.config.*)

Create a `daoflow.config.jsonc` (or `.json`, `.yaml`, `.toml`) for deployment defaults:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/packages/cli/daoflow.config.schema.json",
  "project": "my-app",
  "server": "production",
  "compose": "compose.yaml",
  "context": ".",
  "include": [".env"],        // force-include (overrides .dockerignore)
  "maxContextSize": "500mb"   // safety limit
}
```

See `examples/nextjs-docker-compose-example/` for full samples in JSONC, YAML, and TOML.

---

## Project Structure

```
DaoFlow/
├── packages/
│   ├── server/         # API + tRPC router + Drizzle ORM
│   ├── client/         # React web UI
│   ├── cli/            # CLI (uses @trpc/client + bun workspace)
│   └── shared/         # Shared types and constants
├── docker-compose.dev.yml   # Local dev: Postgres, Redis, Temporal
├── docker-compose.yml       # Production: GHCR images + .env secrets
├── temporal-config/         # Temporal dynamic config
└── examples/
    ├── nextjs-daoflow-example/          # Sample app (image deploy)
    └── nextjs-docker-compose-example/   # Sample app (compose + local context)
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install all workspace dependencies |
| `bun run dev` | Start DaoFlow dev server |
| `bun run db:push` | Push Drizzle schema to Postgres |
| `bun run typecheck` | Type-check all packages |
| `bun run lint` | Run ESLint across the monorepo |
| `bun run test:e2e` | Run Playwright E2E tests |
| `docker compose -f docker-compose.dev.yml up -d` | Start local infrastructure |
| `docker compose -f docker-compose.dev.yml down` | Stop local infrastructure |
| `docker compose -f docker-compose.dev.yml logs -f temporal` | Follow Temporal logs |
