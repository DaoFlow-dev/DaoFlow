---
name: server-schema-change
description: Use when changing DaoFlow server schema or persistence flows, including Drizzle schema files, migrations, seed ordering, and database safety rules.
---

# Server Schema Change

Use this skill for DaoFlow server schema, migration, and seed work.

## Load First

1. Repository root [AGENTS.md](../../../AGENTS.md)
2. [packages/server/AGENTS.md](../../../packages/server/AGENTS.md)
3. [validation-gates](../validation-gates/SKILL.md) before commit or push

## Contract

- Tables live in `packages/server/src/db/schema/`, grouped by concern.
- All IDs must stay within the `varchar(32)` limit.
- Never modify a committed migration in place.
- Seed ordering and idempotency rules from `packages/server/AGENTS.md` remain mandatory.
- Preserve agent safety, auditability, and approval boundaries when schema changes affect execution flows.

## Required Flow

1. Change the relevant schema or persistence modules.
2. Generate or add the required migration instead of editing an existing committed migration.
3. Update services, seeds, and contracts affected by the schema change.
4. Run the relevant database checks such as `bun run db:migrate`, `bun run db:generate`, or issue-specific recovery commands when the change requires them.
5. Run changed-surface tests plus [validation-gates](../validation-gates/SKILL.md).

## Guardrails

- Prefer Drizzle query builder over raw SQL unless a raw query is clearly justified.
- Keep schema files grouped by concern and split large persistence modules before they become mixed-purpose.
- Verify foreign-key ordering and idempotency whenever seed data changes.
