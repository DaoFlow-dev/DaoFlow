---
name: cli-contract-change
description: Use when changing DaoFlow CLI commands or agent-facing CLI behavior, including contract updates, JSON output, scope enforcement, mutation flags, and authz updates.
---

# CLI Contract Change

Use this skill when work touches `packages/cli` command behavior or the CLI contract.

## Load First

1. Repository root [AGENTS.md](../../../AGENTS.md)
2. [packages/cli/AGENTS.md](../../../packages/cli/AGENTS.md)
3. [cli-contract.md](../../references/cli-contract.md)
4. [validation-gates](../validation-gates/SKILL.md) before commit or push

## Contract

- [cli-contract.md](../../references/cli-contract.md) is the source of truth for command lanes, scopes, JSON output, and mutation guardrails.
- Keep JSON output on stdout and route progress or prose to stderr when practical.
- Preserve structured permission-denied responses with the exact required scope.
- Mutating commands must keep `--dry-run`, `--yes`, and idempotency behavior aligned with the contract.
- Update `packages/shared/src/authz.ts` when a command introduces or changes scopes.

## Required Flow

1. Change the relevant `src/commands/<name>.ts` module and any supporting CLI helpers.
2. Update `src/index.ts` when command registration changes.
3. Update [cli-contract.md](../../references/cli-contract.md) when flags, JSON shape, scopes, or command lanes change.
4. Add or update tests covering JSON output, permission checks, and mutation flags for the touched command.
5. Smoke-test `./dist/daoflow --help` when packaging, help text, or command registration changes.
6. Run [validation-gates](../validation-gates/SKILL.md).

## Guardrails

- Do not import from `@daoflow/server` or `@daoflow/client`.
- Prefer explicit typed API calls over shell execution.
- Keep command files focused; split broad files instead of extending them.
