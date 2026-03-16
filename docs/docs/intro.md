---
slug: /
sidebar_position: 1
---

# DaoFlow

**Open-source Agentic DevOps System — from prompts to production.**

## The Problem

Every team that runs their own servers knows the pain. You SSH into a VPS, you manually run `docker compose up`, you hope nothing breaks overnight. When your AI coding agent finishes building your app, the last mile — actually deploying it — is still a manual, fragile process.

Cloud platforms like Vercel solve this for simple apps, but they own your infrastructure. Self-hosted tools like Coolify and Dokploy give you control, but they weren't designed for a world where AI agents are doing the work.

**There is no hosting platform that AI agents can operate safely, reliably, and autonomously — while keeping humans fully in control.**

Until now.

## What DaoFlow Is

DaoFlow is the deployment platform built for the age of AI agents. It's what happens when you design a hosting system from scratch assuming that the primary operator isn't a human clicking buttons — it's an AI agent making API calls.

```bash
# Your AI agent deploys with one command
daoflow deploy --service my-app --yes --json
```

But unlike giving an AI agent raw SSH access, DaoFlow ensures:

- **Agents can't break what they shouldn't touch** — scoped permissions, read-only defaults
- **Every action is auditable** — immutable audit trail with actor identity
- **Destructive actions require explicit confirmation** — `--yes` flag, approval gates
- **Humans see everything** — structured deployment timeline, not opaque log blobs
- **Rollback is always one command away** — deterministic, not "best effort"

## Our Principles

Inspired by the open-source philosophy of projects like OpenClaw — where Peter Steinberger proved that "ship beats perfect" and that agents need **constrained primitives, not unlimited access** — DaoFlow is built on these beliefs:

| Principle | What It Means |
|-----------|---------------|
| **Agent-first, human-supervised** | Every feature works for both AI agents and humans |
| **Safety before autonomy** | Agents default to read-only until explicitly granted write scopes |
| **Ship beats perfect** | A working deployment pipeline today beats a perfect one never |
| **Your servers, your rules** | Self-hosted, inspectable, no vendor lock-in — just Docker Compose |
| **Structured over pretty** | JSON to stdout, prose to stderr — agents parse, humans read |
| **Auditability over convenience** | Every mutation produces an immutable record |
| **Transparency over magic** | The Compose file is right there. No hidden abstractions |

## Quick Start

```bash
# Install DaoFlow on your server (one command)
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh

# Or install just the CLI
curl -fsSL -o /usr/local/bin/daoflow \
  https://github.com/DaoFlow-dev/DaoFlow/releases/latest/download/daoflow-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
chmod +x /usr/local/bin/daoflow

# Login and verify
daoflow login --url https://your-instance.com --token YOUR_TOKEN
daoflow whoami --json
daoflow capabilities --json
```

## How It Works

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  AI Agent   │────▶│   DaoFlow Control    │────▶│  Your Servers   │
│  or Human   │     │   Plane (API+UI)     │     │  (Docker/SSH)   │
└─────────────┘     └──────────────────────┘     └─────────────────┘
       │                      │                          │
   CLI/API             Postgres + Redis           Docker Compose
   --json              Audit Trail                Volumes
   --dry-run           RBAC + Scopes              Health Checks
   --yes               Approval Gates             Backups
```

**Three API lanes** keep agents safe:

| Lane | Purpose | Example | Mutating? |
|------|---------|---------|:---------:|
| **Read** | Observe current state | `daoflow status --json` | No |
| **Planning** | Preview what would happen | `daoflow deploy --dry-run` | No |
| **Command** | Execute changes | `daoflow deploy --yes` | Yes |

## Documentation

| Section | Description |
|---------|-------------|
| [Getting Started](/docs/getting-started) | Install, configure, and deploy your first app |
| [Core Concepts](/docs/concepts/architecture) | Architecture, projects, servers, deployments |
| [CLI Reference](/docs/cli) | Complete CLI command documentation |
| [API Reference](/docs/api) | tRPC API endpoints and authentication |
| [Security & RBAC](/docs/security) | Roles, scopes, tokens, and audit |
| [Deployments](/docs/deployments) | Compose, Dockerfile, and image deployments |
| [Backup & Restore](/docs/backups) | Policies, runs, and S3 storage |
| [Agent Integration](/docs/agents) | Using DaoFlow with AI coding agents |
| [Self-Hosting](/docs/self-hosting) | Deploy DaoFlow on your own infrastructure |
| [Comparisons](/docs/comparisons) | How DaoFlow compares to alternatives |
| [Contributing](/docs/contributing) | Development setup, testing, and code style |

## The Vision

DaoFlow should be **the deployment platform your AI coding agent reaches for**. Not because it's the most complex — because it's the most trustworthy. The one where you know exactly what happened, who did it, and how to undo it.

We're building the hosting platform that AI agents can operate safely — so that "deploy to production" becomes as reliable as "commit to git."

**Open source. Self-hosted. Agent-safe. Human-controlled.**
