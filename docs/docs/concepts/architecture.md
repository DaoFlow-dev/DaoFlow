---
sidebar_position: 1
---

# Architecture

DaoFlow is split into a **control plane** and an **execution plane**, following the principle of separating orchestration from execution.

## System Overview

```
┌──────────────────────────────────────────────────────┐
│                   CONTROL PLANE                      │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐       │
│  │  Web UI  │  │ tRPC API │  │  CLI Client  │       │
│  │ (React)  │  │ (Server) │  │  (External)  │       │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘       │
│       │             │                │               │
│  ┌────┴─────────────┴────────────────┴────────────┐ │
│  │            Control-Plane Core                   │ │
│  │  • Better Auth + RBAC                           │ │
│  │  • Read / planning / command lanes              │ │
│  │  • Deployment + backup records                  │ │
│  │  • Audit trail + event timeline                 │ │
│  └────┬───────────────────────────────────────────┘ │
│       │                                             │
│  ┌────┴───────────────┐  ┌───────────────────────┐ │
│  │ Legacy Worker      │  │ Temporal Client       │ │
│  │ (in-process)       │  │ + Worker (opt-in)     │ │
│  └────┬───────────────┘  └────────┬──────────────┘ │
│       │                            │                │
│  ┌────┴────────────────────────────┴──────────────┐ │
│  │ PostgreSQL 17 • Redis 7 • Temporal stack       │ │
│  └────────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────────┘
                     │ Docker socket / SSH
┌────────────────────┴────────────────────────────────┐
│                 EXECUTION PLANE                      │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ Managed host(s) with Docker + Compose          │ │
│  │ • No DaoFlow agent installation required       │ │
│  │ • SSH-mediated command execution               │ │
│  │ • Container logs and volume operations         │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Control Plane

The control plane is responsible for:

- **Web UI** — React dashboard built with Vite and shadcn/ui
- **API** — type-safe tRPC procedures organized into read, planning, and command lanes
- **Authentication** — Better Auth with email/password and session management
- **Authorization** — role-based access control with scoped tokens
- **State** — PostgreSQL for persistent data and Redis for coordination
- **Audit** — immutable audit log for every write operation

### Tech Stack

| Component   | Technology               |
| ----------- | ------------------------ |
| Runtime     | Bun                      |
| API Layer   | tRPC                     |
| Auth        | Better Auth              |
| ORM         | Drizzle ORM              |
| Database    | PostgreSQL 17            |
| Cache/Queue | Redis 7                  |
| Web UI      | React + Vite + shadcn/ui |

## Execution Boundaries

DaoFlow keeps orchestration and execution intentionally separate:

- **API layer** accepts read, planning, and command requests, validates authz, and records intent.
- **Legacy worker** runs inside the `daoflow` container when `/var/run/docker.sock` is mounted and executes Docker or SSH-backed operations directly.
- **Temporal mode** is optional. When `DAOFLOW_ENABLE_TEMPORAL=true`, the API enqueues durable workflows and the Temporal worker executes the same deployment and backup activities with persistence and retries.
- **Managed hosts** never need a DaoFlow agent installed. They only need SSH access plus Docker Engine and Docker Compose.

This keeps long-running deploy, rollback, backup, and restore work out of the request-response path even though the control plane owns the records, permissions, and auditability.

## Execution Plane

The execution plane runs on managed servers and handles:

- Docker and Docker Compose commands
- log streaming from containers
- health checks
- backup execution and restores
- volume management

## Connectivity Model

DaoFlow connects to managed servers over **SSH**. This means:

- no agent installation required on managed servers
- works with any Linux server that has Docker installed
- SSH key-based authentication
- command execution with timeout and output capture

Local control-plane execution also relies on the Docker socket mount inside the `daoflow` container. That is how the control plane can stage artifacts, inspect Compose inputs, and drive local Docker and Compose operations without placing agent binaries on the managed host.

## API Three-Lane Model

The API is organized into three lanes for safety:

| Lane         | Purpose                            | Side Effects |
| ------------ | ---------------------------------- | ------------ |
| **Read**     | Observe infrastructure state       | None         |
| **Planning** | Preview changes and generate plans | None         |
| **Command**  | Execute mutations                  | Yes, audited |

This design ensures AI agents can safely observe and plan without accidentally mutating infrastructure. See the [API Reference](/docs/api) for details.

## Domain Model

```
Organization
  └── Members (users, agents, service accounts)
  └── API Tokens (scoped permissions)
  └── Projects
       └── Environments
            └── Services
                 └── Deployments
                      └── Deployment Steps
                      └── Deployment Logs
  └── Servers
       └── Health Checks
  └── Volumes
  └── Backup Policies
       └── Backup Runs
       └── Backup Restores
  └── Events
  └── Audit Entries
```
