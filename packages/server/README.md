# @daoflow/server

Hono-based API server powering the DaoFlow control plane.

## Stack

- **Runtime**: Bun
- **Framework**: [Hono](https://hono.dev/) (replaced Express)
- **API**: tRPC v11 via `@hono/trpc-server`
- **Auth**: Better Auth (email/password, RBAC)
- **ORM**: Drizzle ORM 0.45 with PostgreSQL 17 + pgvector
- **Validation**: Zod v4

## Key directories

| Path                   | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `src/app.ts`           | Hono app with middleware (CORS, logger, security, tRPC) |
| `src/index.ts`         | `Bun.serve()` entry point                               |
| `src/router.ts`        | tRPC router with all procedures                         |
| `src/context.ts`       | tRPC context factory                                    |
| `src/db/schema/`       | Drizzle table definitions                               |
| `src/db/services/`     | Business logic (queries, seed data)                     |
| `src/db/migration.ts`  | Standalone migration runner (enables pgvector)          |
| `src/routes/images.ts` | Non-tRPC REST endpoint for image uploads                |

## Scripts

```bash
bun run dev          # Watch mode
bun run build        # tsup production build
bun run typecheck    # tsc --noEmit
bun run test         # vitest with coverage
```

## Environment variables

| Variable             | Required | Description                       |
| -------------------- | -------- | --------------------------------- |
| `DATABASE_URL`       | Yes      | PostgreSQL connection string      |
| `REDIS_URL`          | Yes      | Redis connection string           |
| `BETTER_AUTH_SECRET` | Yes      | Auth signing secret (≥32 chars)   |
| `BETTER_AUTH_URL`    | Yes      | Public URL for Better Auth        |
| `ENCRYPTION_KEY`     | Yes      | 32-char key for secret encryption |
