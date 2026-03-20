---
sidebar_position: 1
---

# Getting Started

Get up and running with DaoFlow in under 5 minutes. DaoFlow is an agent-first hosting platform for deterministic Docker systems — designed so AI coding agents and humans can deploy, inspect, and manage applications safely.

## Prerequisites

| Requirement    | Minimum Version |
| -------------- | --------------- |
| Bun            | 1.3+            |
| Docker Engine  | 20.10+          |
| Docker Compose | v2.0+           |
| Git            | any recent      |
| Temporal CLI   | recommended     |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/DaoFlow-dev/DaoFlow.git
cd DaoFlow

# Install dependencies
bun install

# Start local infrastructure
bun run dev:infra

# Push the schema into the local dev database
bun run db:push

# Start the API + web UI
bun run dev

# Optional: enable Temporal-backed workflows in a second terminal
bun run dev:temporal
```

Local endpoints:

- API server: `http://localhost:3000`
- Vite web UI: `http://localhost:5173`
- Temporal UI: `http://localhost:8233` when `bun run dev:temporal` is running

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
4. **[Staging Runbook](/docs/self-hosting/staging-runbook)** — Rehearse production bring-up before going live

## For AI Agents

If you're an AI coding agent, start with the [CLI reference](/docs/cli) or the [Agent Integration guide](/docs/agents). The CLI supports `--json` output on every command for structured machine-readable responses.

```bash
# Install the CLI
curl -fsSL -o /usr/local/bin/daoflow \
  https://github.com/DaoFlow-dev/DaoFlow/releases/latest/download/daoflow-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
chmod +x /usr/local/bin/daoflow

# Authenticate
daoflow login --url http://localhost:3000 --token YOUR_TOKEN

# Check your permissions
daoflow capabilities --json
```
