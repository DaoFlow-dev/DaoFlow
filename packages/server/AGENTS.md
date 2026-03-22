# @daoflow/server — Agent Rules

## Scope

This file holds server-local rules. For schema, migration, and seed work, use [server-schema-change](../../.agents/skills/server-schema-change/SKILL.md).

## Build & Test

- Run `bun run typecheck` before committing.
- Run `bun --filter @daoflow/server test` for server-only changed-surface validation with coverage.
- Still run the repo-wide root validation gates from the root `AGENTS.md` before commit and push.
- Server uses Hono (NOT Express). Never import from `express`.

## Schema & Migrations

- Tables are defined in `src/db/schema/`. Each file groups related tables.
- All IDs use `varchar(32)` — keep generated IDs under 32 characters.
- Run `bun run db:migrate` to apply Drizzle migrations with pgvector enabled.
- Run `bun run db:push:ci` in CI to push schema without migrations.
- Never modify migration files after they are committed.

## Seed Data

- Seed logic lives in `src/db/services/seed.ts`.
- Seed runs lazily via `ensureControlPlaneReady()` on first request.
- All seed IDs must be ≤32 characters (varchar constraint).
- Seed inserts use `onConflictDoNothing()` for idempotency.
- Foreign key order matters: users → servers → projects → environments → services → deployments → volumes → backups → restores.

## tRPC Router

- All procedures live in `src/router.ts`.
- Public procedures: `health`, `platformOverview`, `roadmap`.
- Protected procedures require Better Auth session.
- Role-gated procedures check `viewer.data.authz.role`.

## Code Style

- Use `import type` for type-only imports.
- Prefer Drizzle query builder over raw SQL.
- Log errors with structured JSON (Hono logger middleware).
- No floating promises — always `await` or `void` async calls.
- Prefer small modules over large route/service files.
- Split hand-written server files before they grow past ~300 lines.
- Do not add new hand-written files above 500 lines unless the user explicitly asks for it or the file is generated.
