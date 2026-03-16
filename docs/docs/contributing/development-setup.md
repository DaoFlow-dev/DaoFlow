---
sidebar_position: 2
---

# Development Setup

Set up your local environment for DaoFlow development.

## Prerequisites

- **Bun** 1.0+ — [Install](https://bun.sh)
- **Docker** 20.10+ with Docker Compose v2
- **Node.js** 18+ (for Playwright tests)
- **Git**

## Steps

```bash
# 1. Clone the repository
git clone https://github.com/daoflow/daoflow.git
cd daoflow

# 2. Install dependencies
bun install

# 3. Start infrastructure
docker compose up -d

# 4. Run database migrations
bun run db:migrate

# 5. Seed demo data
bun run db:seed

# 6. Start the dev server
bun run dev
```

The dashboard runs on `http://localhost:3000`.

## Package Scripts

| Script               | Description                     |
| -------------------- | ------------------------------- |
| `bun run dev`        | Start dev server (API + client) |
| `bun run build`      | Production build                |
| `bun run start`      | Start production server         |
| `bun run db:migrate` | Run database migrations         |
| `bun run db:seed`    | Seed demo data                  |
| `bun run typecheck`  | TypeScript type checking        |
| `bun run lint`       | ESLint                          |
| `bun run test`       | Unit tests                      |
| `bun run test:e2e`   | End-to-end tests (Playwright)   |

## Monorepo Structure

```
daoflow/
├── packages/
│   ├── server/     # API server (tRPC, auth, DB)
│   ├── client/     # Web dashboard (React, Vite)
│   ├── cli/        # CLI tool (Commander)
│   └── shared/     # Shared types, scopes, utils
├── e2e/            # Playwright E2E tests
├── docs/           # Docusaurus documentation
└── AGENTS.md       # Operating charter
```

## Useful Commands

```bash
# Type-check all packages
bun run typecheck

# Run E2E tests
bunx playwright test

# Run docs E2E tests
bunx playwright test --config playwright-docs.config.ts

# Build CLI binary
cd packages/cli && bun run build
```
