# Next.js Fullstack Example

A production-grade Next.js application with authentication, database, and background jobs — fully
deployable via DaoFlow using Docker Compose.

## Stack

| Layer               | Technology                     |
| ------------------- | ------------------------------ |
| **Framework**       | Next.js 15 (App Router)        |
| **Auth**            | Better Auth (email + password) |
| **Database**        | PostgreSQL 17 via Drizzle ORM  |
| **Background Jobs** | Inngest (self-hosted)          |
| **Deployment**      | DaoFlow + Docker Compose       |

## Quick Start

### Local development

```bash
npm install
docker compose up postgres redis inngest -d
cp .env.example .env
npm run dev
```

### Deploy with DaoFlow

```bash
daoflow deploy --compose ./compose.yaml --server my-server --yes
```

DaoFlow detects `build.context: .`, bundles the local directory, sends it to the target server,
builds the Docker image remotely, and starts all four services.

## Architecture

```
┌─────────────┐    ┌───────────┐
│  Next.js    │───▷│ Postgres  │
│  (web:3000) │    │  (5432)   │
│             │    └───────────┘
│ Better Auth │
│ Inngest SDK │    ┌───────────┐    ┌───────────┐
│             │───▷│  Inngest  │───▷│   Redis   │
└─────────────┘    │  (8288)   │    │  (6379)   │
                   └───────────┘    └───────────┘
```

## Features

- **Sign Up / Sign In** — email + password via Better Auth
- **Dashboard** — protected task list (CRUD)
- **Welcome Email** — Inngest function triggers on user creation
- **Health Check** — `/api/health` for Docker healthcheck
- **Standalone Build** — multi-stage Dockerfile for minimal image
