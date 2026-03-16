# DaoFlow

> The agentic platform to host deterministic systems — from one prompt to production.

DaoFlow is an open-source agentic hosting platform for deterministic Docker and Compose systems on VPS and bare-metal infrastructure with:

- Docker and Docker Compose deployments
- typed control-plane APIs
- agent-safe automation boundaries
- persistent volume and backup awareness
- persistent volume registry with backup coverage and restore-readiness signals
- server onboarding with first-contact readiness checks for SSH, Docker Engine, and Compose
- typed Compose release targets with topology-aware rollout steps
- Compose drift inspection that compares desired specs with the last observed runtime state
- approval queue for high-risk Compose releases and restore drills before execution
- backup restore queue with operator-triggered recovery drills from successful artifacts
- deployment, event, and log visibility
- queued deployment records with immutable step history
- worker-ready execution handoff jobs and an immutable operations timeline
- operator-driven execution lifecycle controls for dispatching, succeeding, and failing jobs
- backup policies, recent backup runs, and manual backup queue triggers
- typed infrastructure inventory for servers, projects, and Compose environments
- agent-ready deployment diagnostics with evidence-backed summaries and safe next actions
- immutable control-plane audit entries for deployment, execution, and backup actions
- append-only deployment log lines with read-only API access and worker lifecycle updates
- encrypted environment variable inventory with redacted secret reads and scoped branch patterns
- rollback planning surfaces with healthy baseline targeting, preflight checks, and recovery steps

## Current Stack

This repository now starts with a small but real full-stack foundation:

- React + Vite for the web UI
- Hono + tRPC for the Node.js control plane
- Vitest for unit tests
- Playwright for end-to-end tests
- Docker multi-stage build for production packaging
- GitHub Actions for CI

## Development

Requirements:

- Bun 1.2+

Install dependencies:

```bash
bun install
```

Optional local environment file:

```bash
cp .env.example .env
```

Run the app in development:

```bash
bun dev
```

This starts:

- the API server on `http://localhost:3000`
- the Vite web UI on `http://localhost:5173`

Auth configuration:

- `BETTER_AUTH_SECRET` is optional in local development and required for production deployments.
- `BETTER_AUTH_URL` should match the externally reachable control-plane origin in production.
- `CORS_ORIGIN` should be set in production to the client origin (e.g. `https://app.daoflow.dev`).
- The first account created in a fresh database is bootstrapped as `owner`; later self-serve sign-ups default to `viewer`.

## Quality Gates

Run linting:

```bash
bun lint
```

Run type-checking:

```bash
bun typecheck
```

Run unit tests:

```bash
bun test:unit
```

Run end-to-end tests:

```bash
bun test:e2e
```

Run the full local verification flow:

```bash
bun verify
```

## Production Build

Build the client and server:

```bash
bun run build
```

Start the production server:

```bash
bun start
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
  -e CORS_ORIGIN=http://localhost:5173 \
  daoflow:local
```

## Product Direction

The product charter for contributors and coding agents lives in [AGENTS.md](./AGENTS.md).
