# DaoFlow AGENTS.md

This file is the short operating guide for humans and coding agents working in this repository.

If the README and this file disagree, follow this file.

## Scope

`AGENTS.md` should stay short and stable.

Keep only:

- Repository operating rules
- Contribution and validation requirements
- Links to detailed references, workflows, and roadmaps

Do not put long project tracking, milestone inventories, or sprawling product detail in this file.

## Instruction Order

1. Root `AGENTS.md` for repo-wide rules
2. The nearest package-level `AGENTS.md` for package-local refinements
3. Repo-local skills under `.agents/skills/` for repeatable workflows
4. `.agents/references/`, `.agents/workflows/`, and `.agents/roadmaps/` for detailed supporting material

## Canonical References

Use these files instead of expanding the root charter:

- [product-charter.md](.agents/charters/product-charter.md) — product thesis, architecture, MVP scope, permission model, UX direction, and implementation hygiene
- [cli-contract.md](.agents/references/cli-contract.md) — CLI contract, scope map, JSON output rules, and command guardrails
- [e2e-implementation-roadmap.md](.agents/roadmaps/e2e-implementation-roadmap.md) — long-lived milestone and task tracking
- [pre-commit.md](.agents/workflows/pre-commit.md) — required validation workflow before commit and push
- [acpx-review.md](.agents/workflows/acpx-review.md) — required Gemini and Claude Code self-review workflow before commit and push
- Package-level `AGENTS.md` files — package-specific rules that refine this root guide
- Repo-local skills under `.agents/skills/` — repeatable GitHub, validation, review, CLI, and schema workflows

## Non-Negotiable Product Constraints

- DaoFlow is Compose-first and Docker-first. Do not broaden scope casually.
- Do not treat DaoFlow as a Kubernetes clone, generic cloud wrapper, or arbitrary shell gateway.
- Agent safety, auditability, and explicit permissions take priority over convenience shortcuts.
- Long-running orchestration, log streaming, backups, and restores belong in workers or runner boundaries, not the frontend process.

## Code Hygiene

- Keep hand-written modules small and composable.
- Split files before they grow past roughly 300 lines.
- Do not add new hand-written files above 500 lines unless the user explicitly asks for it or the file is generated.
- When a file mixes unrelated concerns, split it instead of extending it further.

## Quality Gates

Before every commit and push:

1. Run `bun run format`
2. Run `bun run test:unit`
3. Run `bun run lint`
4. Run `bun run typecheck`
5. If the diff touches `AGENTS.md`, `.agents/`, or `.codex/skills/`, run `bun run skills:check`
6. Run the relevant tests and checks for the changed surface
7. Run ACPX Gemini and Claude Code review via [acpx-review.md](.agents/workflows/acpx-review.md)
8. Ensure Git hooks are installed via `bun install` or `bun run hooks:install`
9. Use a conventional commit message
10. Push and verify GitHub Actions status

CI verification details and recovery steps live in [pre-commit.md](.agents/workflows/pre-commit.md).

## Placement Rules

- Stable repository policy belongs in `AGENTS.md`.
- Detailed specs and interface contracts belong in `.agents/references/`.
- Step-by-step procedures belong in `.agents/workflows/`.
- Repeatable execution patterns belong in `.agents/skills/`.
- Project tracking belongs in `.agents/roadmaps/`.
- If a document starts behaving like a workflow, spec, or backlog, move it out of `AGENTS.md`.
