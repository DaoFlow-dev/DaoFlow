---
sidebar_position: 1
---

# Core Concepts

Understand how DaoFlow thinks about infrastructure, deployment, and agent safety.

## Philosophy

DaoFlow is built on two core beliefs:

1. **AI agents are the future of infrastructure management** — they should observe, plan, and execute deployments with proper safety boundaries
2. **Self-hosted infrastructure should be simpler than cloud** — not more complex

Read the full [Vision & Principles](./vision) to understand why.

## How It Works

```
Your Code → DaoFlow → Your Servers
         ↑            ↑
    AI Agent        SSH + Docker
```

DaoFlow sits between your code (or your AI agent) and your servers. It orchestrates Docker Compose deployments over SSH, tracks every change, and ensures agents operate within scoped permissions.

## Key Concepts

| Concept                                                | What It Is                            | Why It Matters                                                                   |
| ------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------- |
| [Architecture](./architecture)                         | Control plane + execution plane split | Separates orchestration from execution; Docker doesn't run in the web process    |
| [Projects & Environments](./projects-and-environments) | Organizational hierarchy              | Group services by project, deploy to different environments (prod, staging, dev) |
| [Servers](./servers)                                   | SSH-connected Docker hosts            | DaoFlow manages your servers — any Linux box with Docker installed               |
| [Deployments](./deployments)                           | Immutable deployment records          | Every deploy captures input, config, actor, timestamps, and outcome              |
| [Services](./services)                                 | Runtime units (containers)            | The thing that actually runs — from Compose, Dockerfile, or image                |
| [Vision & Principles](./vision)                        | Why DaoFlow exists                    | Security-first, data ownership, transparency, deterministic by design            |

## The Safety Stack

What makes DaoFlow different from every other deployment tool:

```
                    ┌─────────────────────┐
                    │   Approval Gates    │ ← Human-in-the-loop for dangerous ops
                    ├─────────────────────┤
                    │   Audit Trail       │ ← Every mutation logged
                    ├─────────────────────┤
                    │   API Lane Separation│ ← Read / Plan / Command
                    ├─────────────────────┤
                    │   Token Scoping     │ ← Per-token permission limits
                    ├─────────────────────┤
                    │   Role Capabilities │ ← Role defines max permissions
                    ├─────────────────────┤
                    │   Agent Principal   │ ← Dedicated identity (read-only default)
                    └─────────────────────┘
```

Six layers of safety between an AI agent and your production infrastructure. Not because we don't trust AI — because we trust good architecture.
