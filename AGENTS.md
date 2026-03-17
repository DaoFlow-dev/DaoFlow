# DaoFlow AGENTS.md

This file is the short operating guide for humans and coding agents working in this repository.

If the README and this file disagree, follow this file.

## What Belongs Here

`AGENTS.md` should stay short and stable.

Keep only:

- Repository operating rules
- Contribution and validation requirements
- Links to detailed charter, workflow, and roadmap files

Do not put long project tracking, milestone inventories, or sprawling product detail in this file.

## Canonical References

Use these files instead of expanding the root charter:

- [product-charter.md](/Volumes/QuickMac/DaoFlow-clone-3/.agents/charters/product-charter.md) — product thesis, architecture, MVP scope, permission model, UX direction, and implementation hygiene
- [cli-contract.md](/Volumes/QuickMac/DaoFlow-clone-3/.agents/references/cli-contract.md) — CLI contract, scope map, JSON output rules, and command guardrails
- [e2e-implementation-roadmap.md](/Volumes/QuickMac/DaoFlow-clone-3/.agents/roadmaps/e2e-implementation-roadmap.md) — long-lived milestone and task tracking
- [pre-commit.md](/Volumes/QuickMac/DaoFlow-clone-3/.agents/workflows/pre-commit.md) — required validation workflow before commit and push
- Package-level `AGENTS.md` files — package-specific rules that refine this root guide

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
2. Run `bun run lint`
3. Run `bun run typecheck`
4. Run the relevant tests for the changed surface
5. Ensure Git hooks are installed via `bun install` or `bun run hooks:install`
6. Use a conventional commit message
7. Push and verify GitHub Actions status

CI verification details and recovery steps live in [pre-commit.md](/Volumes/QuickMac/DaoFlow-clone-3/.agents/workflows/pre-commit.md).

## Roadmap Policy

Project tracking belongs under `.agents/roadmaps/`.

If a planning document starts acting like a roadmap, milestone list, or evolving backlog, move it there instead of keeping it in `AGENTS.md`.
