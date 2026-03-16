---
sidebar_position: 3
---

# Architecture Guide

How the DaoFlow codebase is organized.

## Package Overview

### `packages/server`
The API server, built with tRPC and Better Auth.

```
server/
├── src/
│   ├── routes/
│   │   ├── read.ts        # Read-only API endpoints
│   │   ├── command.ts     # Mutating API endpoints
│   │   └── tokens.ts      # API token management
│   ├── db/
│   │   ├── schema/        # Drizzle ORM schema definitions
│   │   │   ├── core.ts    # orgs, principals, tokens
│   │   │   ├── infra.ts   # servers, projects, envs, services
│   │   │   ├── deployments.ts  # deployment records and steps
│   │   │   ├── data.ts    # volumes, backups
│   │   │   └── audit.ts   # events, audit entries
│   │   └── services/      # Business logic layer
│   ├── trpc.ts            # tRPC procedure definitions
│   └── index.ts           # Server entry point
```

### `packages/client`
The web dashboard, built with React and Vite.

```
client/
├── src/
│   ├── pages/           # Route-level page components
│   ├── features/        # Feature-specific components
│   ├── layouts/         # Layout wrappers (dashboard, public)
│   ├── hooks/           # Custom React hooks
│   └── lib/             # Utilities and tRPC client setup
```

### `packages/cli`
The agent-first CLI, built with Commander.

```
cli/
├── src/
│   ├── commands/        # Individual CLI commands
│   ├── api-client.ts    # HTTP client for tRPC API
│   └── index.ts         # CLI entry point
```

### `packages/shared`
Shared code between server, client, and CLI.

```
shared/
├── src/
│   ├── authz.ts         # Roles, scopes, and capability checks
│   └── types.ts         # Shared TypeScript types
```

## Data Flow

```
User/Agent → CLI/Dashboard → tRPC API → Business Logic → Drizzle ORM → PostgreSQL
                                ↓
                          Audit Log + Events
```

## Key Design Patterns

- **Three-lane API** — read, planning, command
- **Scoped procedures** — `scopedProcedure()` middleware checks scopes
- **Actor context** — `getActorContext()` helper deduplicates auth info
- **Immutable records** — deployments and audit entries are append-only
- **Structured errors** — all errors include machine-readable codes
