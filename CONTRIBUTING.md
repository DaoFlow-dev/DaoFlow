# Contributing to DaoFlow

## Development Setup

```bash
# Clone the repository
git clone https://github.com/daoflow-dev/daoflow.git
cd daoflow

# Install dependencies
bun install

# Start development infrastructure (Postgres, Redis)
bun run dev:infra

# Start development servers (API + UI)
bun run dev

# With Temporal workflows enabled
bun run dev:full
```

The API runs on `http://localhost:3000` by default. The first user to sign up gets the `owner` role.

## Project Structure

```
packages/
  shared/     Shared types, constants, and utilities
  server/     Hono API server, tRPC router, Drizzle ORM, Temporal workers
  client/     React 19 + Vite dashboard (Tailwind CSS 4, shadcn/ui)
  cli/        Standalone CLI binary (Commander.js, compiled via Bun)
```

## Quality Gates

Run these before every commit:

```bash
bun run format        # Prettier
bun run lint          # ESLint
bun run typecheck     # TypeScript (all packages)
bun run test:unit     # Vitest (server) + Bun test (CLI) + Vitest (client)
bun run contracts:check  # tRPC contract validation
```

## Running Tests

```bash
# Unit tests (all packages)
bun run test:unit

# E2E tests (requires running dev infrastructure)
bun run test:e2e

# Specific E2E suite
bun run test:e2e:main
bun run test:e2e:cli
bun run test:e2e:bootstrap
```

## CLI Development

```bash
# Build CLI for current platform
cd packages/cli && bun run build

# Build for Linux
cd packages/cli && bun run build:linux

# Build for all platforms
cd packages/cli && bun run build:all
```

## Database Migrations

```bash
# Generate a new migration
bun run db:generate

# Apply migrations
bun run db:migrate

# Reset and re-seed (development only)
bun packages/server/src/db/reset.ts
bun run db:migrate
bun packages/server/src/db/services/run-seed.ts
```

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(scope):` — new feature
- `fix(scope):` — bug fix
- `refactor(scope):` — code restructuring
- `chore(scope):` — maintenance
- `docs(scope):` — documentation

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes with passing quality gates
3. Push and open a PR against `main`
4. PRs require passing CI checks before merge

## Architecture Notes

- **Compose-first**: DaoFlow deploys Docker Compose projects. Do not broaden scope casually.
- **tRPC**: All API procedures use tRPC with Zod validation. Add new procedures to the appropriate router in `packages/server/src/routes/`.
- **CLI contract**: Every CLI command must support `--json`. Mutating commands need `--yes`. Destructive commands need confirmation. See `.agents/references/cli-contract.md`.
- **Temporal**: Long-running operations (deploy, backup, restore) use Temporal workflows when enabled via `DAOFLOW_ENABLE_TEMPORAL=true`.
- **File size**: Keep files under 300 lines. Split before they grow past 500.
