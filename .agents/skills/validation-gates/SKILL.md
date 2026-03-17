---
name: validation-gates
description: Use when validating DaoFlow changes before commit or push, including format, tests, lint, typecheck, conditional instruction checks, and CI follow-through.
---

# Validation Gates

Use this skill before every DaoFlow `git commit` and `git push`.

## Load First

1. Repository root [AGENTS.md](../../../AGENTS.md)
2. The nearest package-level `AGENTS.md` for files you will edit
3. [.agents/workflows/pre-commit.md](../../workflows/pre-commit.md) when you need the full recovery flow

## Gate Order

Run these checks in order:

1. `bun run format`
2. `bun run test:unit`
3. `bun run lint`
4. `bun run typecheck`
5. If the diff touches `AGENTS.md`, `.agents/`, or `.codex/skills/`, run `bun run skills:check`
6. Run changed-surface checks for the files you touched
7. Run [acpx-review](../acpx-review/SKILL.md)

## Push Follow-Through

- Ensure Git hooks are installed via `bun install` or `bun run hooks:install`.
- Use a conventional commit message.
- After push, verify GitHub Actions with `gh run list --limit 2 --json databaseId,status,conclusion,name`.
- If CI fails, inspect the failing run with `gh run view <RUN_ID> --log-failed` and loop back to step 1.

## Pass Criteria

- Formatting applied cleanly
- `bun run test:unit` passes
- `bun run lint` reports 0 errors
- `bun run typecheck` passes
- `bun run skills:check` passes when instruction files changed
- Changed-surface checks pass
- ACPX review has no blocking findings
- Required CI checks are green after push
