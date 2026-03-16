---
sidebar_position: 3
---

# DaoFlow vs Coolify & Dokploy

Coolify and Dokploy are open-source, self-hosted PaaS platforms. Like DaoFlow, they let you deploy Docker applications on your own servers. The difference is that DaoFlow is built **agent-first** — designed from day one for AI coding agents to operate safely alongside humans.

## The Core Difference

**Coolify and Dokploy** are excellent UI-driven platforms for humans managing deployments through dashboards. Their APIs exist but are secondary to the GUI experience.

**DaoFlow** is agent-driven. Every feature is designed so an AI coding agent can deploy, diagnose, and rollback infrastructure — with dedicated permission controls that prevent agents from accidentally wiping production data or leaking secrets.

## Comparison

|                         | DaoFlow                                                                   | Coolify                    | Dokploy                        |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------- | ------------------------------ |
| **Primary interface**   | CLI + API (agent-first), UI for humans                                    | Dashboard-first            | Dashboard-first                |
| **AI agent support**    | Dedicated agent principals, scoped tokens, structured JSON, `--dry-run`   | No agent-specific features | No agent-specific features     |
| **Permission model**    | 26 granular scopes, agent role, per-token scoping                         | Basic admin/member roles   | Basic user roles               |
| **Secret protection**   | Masked by default, `secrets:read` scope required, never in logs           | Visible in dashboard       | Visible in dashboard           |
| **Audit trail**         | Immutable audit log on every write — actor, action, timestamp, outcome    | Basic activity log         | Basic deployment history       |
| **API design**          | Three lanes: read → planning → command (agents can't accidentally mutate) | Single API surface         | Single API with JWT auth       |
| **CLI output**          | `--json` on every command, deterministic exit codes (0/1/2/3)             | No CLI                     | No CLI                         |
| **Dry-run previews**    | Every mutating command supports `--dry-run`                               | Not available              | Not available                  |
| **Approval gates**      | Built-in for high-risk operations (backup restore, production deploys)    | Not available              | Not available                  |
| **Docker Compose**      | First-class, preserves original + resolved spec                           | Supported                  | Strong native support          |
| **Docker Swarm**        | Planned (standalone Docker first)                                         | Supported                  | Native integration             |
| **One-click templates** | Focused on Compose patterns                                               | 280+ templates             | 200+ templates                 |
| **Monitoring**          | Structured event timeline + agent-ready summaries                         | Container metrics          | Real-time per-resource metrics |
| **Backups**             | Typed policies, S3 storage, restore workflows with approval gates         | S3 backups                 | Unlimited S3 backups           |

## Why Agent Safety Matters

When an AI agent has access to your infrastructure, the permission model is critical:

```
# Coolify / Dokploy: broad API access, no agent-specific guardrails
# The agent can do anything the API token allows — no safety boundaries

# DaoFlow: dedicated agent principal with explicit scopes
daoflow capabilities --json
# → { "scopes": ["server:read", "deploy:read", "logs:read", "events:read"] }
# Agent can observe everything but cannot deploy, modify env vars, or read secrets
# until explicitly granted those scopes

# Safe deployment workflow
daoflow deploy --service my-app --compose ./compose.yaml --dry-run  # Preview first
daoflow deploy --service my-app --compose ./compose.yaml --yes       # Execute with confirmation
```

## When to Choose DaoFlow

- You use **AI coding agents** (Cursor, Copilot, custom) to manage infrastructure
- You need **fine-grained permissions** — not just admin/member, but scoped capabilities
- You want agents that can **observe and plan without accidentally mutating** production
- **Secret protection** is critical — agents should never see production credentials unless explicitly authorized
- You need an **immutable audit trail** of every action taken by humans and agents
- You want **approval gates** for dangerous operations like backup restores

## When to Choose Coolify or Dokploy

- You manage infrastructure **manually through a dashboard** and don't use AI agents
- You want **one-click app templates** for quick setup (WordPress, Ghost, etc.)
- You need **Docker Swarm** clustering today (DaoFlow MVP focuses on standalone Docker)
- You prefer a **mature ecosystem** with larger community and extensive templates

## The DaoFlow Advantage

DaoFlow gives you the self-hosting benefits of Coolify and Dokploy — own your infrastructure, no vendor lock-in, open source — plus dedicated agent-safety features that let your AI fully empower your DevOps without worrying about wiping out production data or leaking production credentials.
