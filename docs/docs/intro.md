---
slug: /
sidebar_position: 1
---

# DaoFlow Documentation

**The agentic platform to host deterministic systems — from one prompt to production.**

DaoFlow is an open-source Agentic DevOps System — from prompts to production. It's designed so that AI coding agents can deploy, inspect, diagnose, and rollback applications safely and reliably — while keeping humans fully in control.

## Why DaoFlow?

Every hosting platform was designed for humans. DaoFlow is designed for **AI agents and humans together** — with security as architecture, not afterthought:

- **Your data, your servers** — self-hosted on your infrastructure, zero vendor lock-in
- **Agent-safe by default** — read-only until explicitly granted write scopes; every mutation audited
- **Deterministic** — same input, same output, every time; no magic, no surprises
- **Open source** — fully transparent, inspectable, MIT-licensed

Read the full [Vision & Principles →](/docs/concepts/vision)

## What is DaoFlow?

DaoFlow combines the strengths of tools like Coolify, Dokploy, and Portainer with an agent-first architecture:

- **Agent-first CLI** — AI agents can call `daoflow deploy`, `daoflow status`, `daoflow rollback` directly from their tool-calling loops with structured JSON output
- **Agent-first API** — Three lanes (read, planning, command) so agents can observe and plan without accidentally mutating infrastructure
- **Docker Compose native** — First-class support for Compose-based deployments on bare metal and VPS
- **Safety by default** — Agents default to read-only; destructive actions require explicit scopes and `--yes` confirmation
- **Full audit trail** — Every mutation produces an immutable audit record

## Quick Start

```bash
# Install the CLI
curl -fsSL -o /usr/local/bin/daoflow \
  https://github.com/DaoFlow-dev/DaoFlow/releases/latest/download/daoflow-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
chmod +x /usr/local/bin/daoflow

# Login to your DaoFlow instance
daoflow login --url https://your-instance.com --token YOUR_TOKEN

# Check server status
daoflow status --json

# Deploy a service
daoflow deploy --service my-app --server vps1 --compose ./compose.yaml --yes

# View your permissions
daoflow capabilities --json
```

## Documentation Sections

| Section                                      | Description                                   |
| -------------------------------------------- | --------------------------------------------- |
| [Getting Started](/docs/getting-started)     | Install, configure, and deploy your first app |
| [Core Concepts](/docs/concepts/architecture) | Architecture, projects, servers, deployments  |
| [Vision & Principles](/docs/concepts/vision) | Why DaoFlow, open-source philosophy           |
| [CLI Reference](/docs/cli)                   | Complete CLI command documentation            |
| [API Reference](/docs/api)                   | tRPC API endpoints and authentication         |
| [Comparisons](/docs/comparisons)             | How DaoFlow compares to other platforms       |
| [Security & RBAC](/docs/security)            | Roles, scopes, tokens, and audit              |
| [Deployments](/docs/deployments)             | Compose, Dockerfile, and image deployments    |
| [Backup & Restore](/docs/backups)            | Policies, runs, and S3 storage                |
| [Agent Integration](/docs/agents)            | Using DaoFlow with AI coding agents           |
| [Self-Hosting](/docs/self-hosting)           | Deploy DaoFlow on your own infrastructure     |
| [Contributing](/docs/contributing)           | Development setup, testing, and code style    |
