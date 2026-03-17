# @daoflow/cli — Agent Rules

## Scope

This file only holds CLI-local implementation rules. For the command contract, JSON output, scope map, and agent-facing behavior, use [cli-contract.md](../../.agents/references/cli-contract.md). For CLI command and contract work, use [cli-contract-change](../../.agents/skills/cli-contract-change/SKILL.md).

## Build & Validation

- Run `bun run typecheck` before committing.
- Build binaries with `bun run build` (or platform-specific variants).
- Built binaries go to `dist/` which is gitignored.
- Smoke-test the compiled binary with `./dist/daoflow --help` when CLI behavior or packaging changes.

## Local Structure

- `src/index.ts` registers commands.
- Keep one command per `src/commands/<name>.ts`.
- Split command files before they become broad or mixed-purpose.

## Local Rules

- Use `import type` for type-only imports.
- Do not import from `@daoflow/server` or `@daoflow/client`.
- Prefer `commander`'s built-in argument parsing over manual `process.argv`.
- Keep commands focused and prefer explicit typed adapters over shell execution.
- Keep agent-mode stdout structured and send progress or prose to stderr when practical.

## Adding New Commands

When adding a new command:

1. Create or update the relevant `src/commands/<name>.ts` module and wire it through `src/index.ts`.
2. Update [cli-contract.md](../../.agents/references/cli-contract.md) if behavior, flags, scopes, or JSON output change.
3. Add or update tests covering JSON output, permission checks, and mutation flags as appropriate.
4. Update `packages/shared/src/authz.ts` if new scopes are needed.
