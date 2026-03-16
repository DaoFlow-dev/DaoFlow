---
sidebar_position: 1
---

# Architecture

DaoFlow is split into a **control plane** and an **execution plane**, following the principle of separating orchestration from execution.

## System Overview

```
┌─────────────────────────────────────────────────┐
│                  CONTROL PLANE                   │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Web UI   │  │ tRPC API │  │  CLI Client  │  │
│  │ (React)   │  │ (Server) │  │  (Commander) │  │
│  └─────┬─────┘  └─────┬────┘  └──────┬───────┘  │
│        │              │               │          │
│  ┌─────┴──────────────┴───────────────┴──────┐  │
│  │           Application Core                 │  │
│  │  • Auth (Better Auth)                      │  │
│  │  • RBAC (roles + scoped tokens)            │  │
│  │  • Deployment records & audit log          │  │
│  │  • Event timeline                          │  │
│  └─────────────┬─────────────────────────────┘  │
│                │                                 │
│  ┌─────────────┴─────────────────────────────┐  │
│  │         Data Layer (Drizzle ORM)           │  │
│  │  PostgreSQL 17  │  Redis 7                 │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │ SSH
┌─────────────────────┴───────────────────────────┐
│                EXECUTION PLANE                   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │          Managed Server(s)                │   │
│  │  • Docker Engine                          │   │
│  │  • Docker Compose                         │   │
│  │  • Container logs                         │   │
│  │  • Volume storage                         │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Control Plane

The control plane is responsible for:

- **Web UI** — React dashboard built with Vite and shadcn/ui
- **API** — Type-safe tRPC procedures organized into read, planning, and command lanes
- **Authentication** — Better Auth with email/password, session management
- **Authorization** — Role-based access control with 26 granular scopes
- **State** — PostgreSQL for persistent data, Redis for job queues and SSE streaming
- **Audit** — Immutable audit log for every write operation

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| API Layer | tRPC |
| Auth | Better Auth |
| ORM | Drizzle ORM |
| Database | PostgreSQL 17 |
| Cache/Queue | Redis 7 |
| Web UI | React + Vite + shadcn/ui |

## Execution Plane

The execution plane runs on managed servers and handles:

- Docker and Docker Compose commands
- Log streaming from containers
- Health checks
- Backup execution and restores
- Volume management

### Connectivity Model

DaoFlow connects to managed servers over **SSH**. This means:

- No agent installation required on managed servers
- Works with any Linux server that has Docker installed
- SSH key-based authentication
- Command execution with timeout and output capture

## API Three-Lane Model

The API is organized into three lanes for safety:

| Lane | Purpose | Side Effects |
|------|---------|-------------|
| **Read** | Observe infrastructure state | None |
| **Planning** | Preview changes and generate plans | None |
| **Command** | Execute mutations | Yes — creates audit records |

This design ensures AI agents can safely observe and plan without accidentally mutating infrastructure. See the [API Reference](/docs/api) for details.

## Domain Model

```
Organization
  └── Members (users, agents, service accounts)
  └── API Tokens (scoped permissions)
  └── Projects
       └── Environments (production, staging, dev)
            └── Services
                 └── Deployments
                      └── Deployment Steps
                      └── Deployment Logs
  └── Servers
       └── Health Checks
  └── Volumes
  └── Backup Policies
       └── Backup Runs
  └── Events (operational timeline)
  └── Audit Entries (immutable write log)
```
