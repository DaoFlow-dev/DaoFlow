# DaoFlow

> Bare-metal and VM deployment control plane for Docker-first teams.

DaoFlow is an open-source platform for running applications on VPS and bare-metal infrastructure with:

- Docker and Docker Compose deployments
- typed control-plane APIs
- agent-safe automation boundaries
- persistent volume and backup awareness
- deployment, event, and log visibility
- queued deployment records with immutable step history

## Current Stack

This repository now starts with a small but real full-stack foundation:

- React + Vite for the web UI
- Express + tRPC for the Node.js control plane
- Vitest for unit tests
- Playwright for end-to-end tests
- Docker multi-stage build for production packaging
- GitHub Actions for CI

## Development

Requirements:

- Node.js 22+
- pnpm 10+

Install dependencies:

```bash
pnpm install
```

Optional local environment file:

```bash
cp .env.example .env
```

Run the app in development:

```bash
pnpm dev
```

This starts:

- the API server on `http://localhost:3000`
- the Vite web UI on `http://localhost:5173`

Auth configuration:

- `BETTER_AUTH_DB_PATH` defaults to `./data/auth.sqlite` outside tests and can be pointed at a mounted volume in Docker or production.
- `BETTER_AUTH_SECRET` is optional in local development and required for production deployments.
- `BETTER_AUTH_URL` should match the externally reachable control-plane origin in production.
- `CONTROL_PLANE_DB_PATH` defaults to `./data/control-plane.sqlite` and stores deployment records, steps, and later control-plane state.
- The control-plane database now also seeds principal and API token inventory so scoped automation lanes are testable locally.
- Better Auth now boots its own SQLite schema automatically on first start, so the auth layer is durable without a manual migration step.
- The first account created in a fresh auth database is bootstrapped as `owner`; later self-serve sign-ups default to `viewer`.

## Quality Gates

Run linting:

```bash
pnpm lint
```

Run type-checking:

```bash
pnpm typecheck
```

Run unit tests:

```bash
pnpm test:unit
```

Run end-to-end tests:

```bash
pnpm test:e2e
```

Run the full local verification flow:

```bash
pnpm verify
```

## Production Build

Build the client and server:

```bash
pnpm build
```

Start the production server:

```bash
pnpm start
```

## Docker

Build the image:

```bash
docker build -t daoflow:local .
```

Run it:

```bash
docker run --rm \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -e BETTER_AUTH_SECRET=replace-with-a-long-random-secret \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  daoflow:local
```

## Product Direction

The product charter for contributors and coding agents lives in [AGENTS.md](./AGENTS.md).
