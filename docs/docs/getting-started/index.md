---
sidebar_position: 1
---

# Getting Started

Get up and running with DaoFlow in under 5 minutes. DaoFlow is an agent-first deployment platform for Docker infrastructure — designed so AI coding agents and humans can deploy, inspect, and manage applications safely.

## Prerequisites

| Requirement    | Minimum Version     |
| -------------- | ------------------- |
| Docker Engine  | 20.10+              |
| Docker Compose | v2.0+               |
| Node.js or Bun | Node 18+ / Bun 1.0+ |
| PostgreSQL     | 17                  |
| Redis          | 7.0+                |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/daoflow/daoflow.git
cd daoflow

# Start infrastructure (Postgres + Redis)
docker compose up -d

# Install dependencies
bun install

# Run database migrations
bun run db:migrate

# Seed demo data (optional)
bun run db:seed

# Start the development server
bun run dev
```

The dashboard will be available at `http://localhost:3000`.

## What's Included

DaoFlow ships as a monorepo with four packages:

| Package           | Description                                   |
| ----------------- | --------------------------------------------- |
| `packages/server` | API server (tRPC + Better Auth + Drizzle ORM) |
| `packages/client` | Web dashboard (React + Vite + shadcn/ui)      |
| `packages/cli`    | Agent-first CLI (`daoflow` command)           |
| `packages/shared` | Shared types, scopes, and utilities           |

## First Steps

1. **[Installation](./installation)** — Detailed environment setup
2. **[First Deployment](./first-deployment)** — Deploy your first app
3. **[Configuration](./configuration)** — Customize your instance

## For AI Agents

If you're an AI coding agent, start with the [CLI reference](/docs/cli) or the [Agent Integration guide](/docs/agents). The CLI supports `--json` output on every command for structured machine-readable responses.

```bash
# Install the CLI
bun add -g @daoflow/cli

# Authenticate
daoflow login --url http://localhost:3000 --token YOUR_TOKEN

# Check your permissions
daoflow capabilities --json
```
