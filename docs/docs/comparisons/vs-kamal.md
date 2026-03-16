---
sidebar_position: 5
---

# DaoFlow vs Kamal

Kamal is a deployment tool from 37signals (makers of Basecamp, HEY, and ONCE). It deploys single Docker containers to servers over SSH. DaoFlow is a full DevOps platform built around Docker Compose with AI-agent-first automation.

## The Core Difference

**Kamal** is great at one thing: deploying a single Docker container to a server with zero-downtime rolling restarts. It's "Heroku on your own servers" — simple, opinionated, and designed for Rails apps at 37signals' scale.

**DaoFlow** is a platform, not just a deployer. It manages multi-container Compose stacks, provides a web dashboard, handles backups and restores, enforces granular permissions, and lets AI agents operate infrastructure safely. And with Docker Compose and future Swarm support, you can scale up your cloud computing power when necessary.

## Comparison

|                          | DaoFlow                                                                     | Kamal                                                            |
| ------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Deployment model**     | Docker Compose stacks (multi-container)                                     | Single Docker container per app                                  |
| **Multi-service apps**   | Native — web + API + database + worker in one Compose file                  | Separate deploys for each service, accessories for databases     |
| **Web dashboard**        | Full UI: deployments, logs, servers, backups, permissions                   | No UI — YAML config + CLI only                                   |
| **AI agent support**     | Agent-first: structured JSON, scoped permissions, `--dry-run`, audit trails | No agent features — outputs human-readable text only             |
| **Permission model**     | 26 granular scopes, agent principals, per-token scoping                     | No built-in permissions — whoever has SSH access can do anything |
| **Monitoring & logging** | Built-in event timeline, structured deployment logs, agent diagnostics      | No built-in monitoring or logging — bring your own               |
| **Secrets management**   | Encrypted storage, masked reads, `secrets:read` scope required              | Relies on external services (1Password, etc.)                    |
| **Backup & restore**     | Typed policies, S3 storage, restore workflows with approval gates           | Not included — manual responsibility                             |
| **Scaling**              | Docker Compose + planned Swarm support                                      | Single container per server, manual multi-server                 |
| **Audit trail**          | Immutable log of every deployment, rollback, config change                  | No audit trail                                                   |
| **Deployment records**   | Full history with input, config, actor, timestamps, outcome                 | Basic deploy/rollback tracking                                   |
| **Framework support**    | Any Docker workload                                                         | Originally Rails, works with any Docker app                      |
| **Configuration**        | `.env` + dashboard + CLI                                                    | `deploy.yml` in repo                                             |

## Why Compose Beats Single Containers

Kamal and similar tools like ONCE by DHH deploy single Docker containers. This works for simple apps, but modern applications are multi-service:

```yaml
# DaoFlow: deploy your entire stack as one unit
services:
  web:
    image: myapp:latest
    ports: ["3000:3000"]
  api:
    image: myapi:latest
    ports: ["4000:4000"]
  db:
    image: postgres:17
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7-alpine
  worker:
    image: myworker:latest

volumes:
  pgdata:
```

With DaoFlow, this entire stack deploys, scales, rolls back, and gets backed up as one unit. With Kamal, you'd manage each service separately.

## When to Choose DaoFlow

- You run **multi-container applications** (web + API + database + workers)
- You want a **web dashboard** alongside CLI access
- You need **AI agents to manage deployments** with proper safety boundaries
- You need **backup and restore workflows** for databases and volumes
- You want **granular permissions** — not just "whoever has SSH access"
- You need to **scale up** with Docker Compose or Swarm as your needs grow
- You want an **audit trail** of every infrastructure change

## When to Choose Kamal

- You deploy a **single Rails app** (or similar) to a server
- You prefer **minimal tooling** — just YAML config and SSH
- You don't need a dashboard or web UI
- You don't use AI agents for infrastructure management
- Your team is comfortable managing monitoring, logging, and backups separately

## The DaoFlow Advantage

DaoFlow is more generic than single-container deployers. It doesn't rely on one Docker container — it uses Docker Compose and supports future Docker Swarm. You can scale up your cloud computing power when necessary, manage complex multi-service applications, and let your AI agents handle the heavy lifting with proper safety boundaries.
