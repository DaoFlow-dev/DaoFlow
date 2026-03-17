---
name: daoflow-github-loop
description: Use when working DaoFlow GitHub issues end-to-end with Codex; this compatibility entrypoint loads the repo-local GitHub, validation, and review skills.
---

# DaoFlow GitHub Loop

Use this skill as a thin entrypoint for DaoFlow GitHub issue and PR work.

## Load Order

Before acting, load:

1. Repository root [AGENTS.md](../../../AGENTS.md)
2. The nearest package-level `AGENTS.md` for files you will edit
3. Repo-local [github-issue-loop](../../../.agents/skills/github-issue-loop/SKILL.md)
4. Repo-local [validation-gates](../../../.agents/skills/validation-gates/SKILL.md)
5. Repo-local [acpx-review](../../../.agents/skills/acpx-review/SKILL.md)

Use `.agents/workflows/pre-commit.md` and `.agents/workflows/acpx-review.md` only when you need the detailed command reference.

## Contract

- GitHub Issues are the work tracker.
- Use the GitHub CLI `gh` as the default interface for GitHub operations from the terminal.
- Default integration path is direct commit and push to `main`.
- Do not create a feature branch unless the user explicitly requests one or the work is already happening on an existing branch/PR.
- Keep scope tight. If you discover extra work, open a follow-up issue instead of expanding scope.
- Use GitHub comments for durable progress notes; do not rely on ephemeral terminal output.
- Never commit or push with failing local gates or failing CI expectations.

## Skill Split

- [github-issue-loop](../../../.agents/skills/github-issue-loop/SKILL.md) owns issue intake, durable comments, PR updates, labels, and CI follow-through.
- [validation-gates](../../../.agents/skills/validation-gates/SKILL.md) owns format, tests, lint, typecheck, instruction checks, and CI verification.
- [acpx-review](../../../.agents/skills/acpx-review/SKILL.md) owns Gemini and Claude Code self-review before commit and push.

## Why This Skill Is Thin

DaoFlow's reusable workflows now live under `.agents/skills/` so they can be invoked independently and validated in CI. Keep this wrapper small and route actual execution to the repo-local skills above.
