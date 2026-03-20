---
name: github-issue-loop
description: Use when executing DaoFlow GitHub issue or PR work with gh, including issue intake, durable progress comments, status labels, PR updates, and CI follow-through.
---

# GitHub Issue Loop

Use this skill for DaoFlow issue and PR execution through the GitHub CLI.

## Load First

1. Repository root [AGENTS.md](../../../AGENTS.md)
2. The nearest package-level `AGENTS.md` for files you will edit
3. [validation-gates](../validation-gates/SKILL.md) before commit or push
4. [acpx-review](../acpx-review/SKILL.md) before commit or push

## Operating Contract

- GitHub Issues are the work tracker.
- Use `gh` for GitHub operations unless there is a clear reason not to.
- Default integration path is direct commit and push to `main`.
- If the user explicitly says to stop after local completion without commit or push, honor that request: finish local validation, update the durable issue comment, and close the issue when the scoped work is complete.
- Do not create a feature branch unless the user explicitly requests one or the work already lives on a branch or PR.
- Keep scope tight. If you discover worthwhile extra work, open a follow-up issue instead of broadening the current one.
- When a feature, contract, operator flow, or user-facing behavior changes, update the relevant docs in the same loop instead of leaving documentation drift behind.
- Use GitHub comments for durable progress notes.
- Never declare work ready or push with failing local gates.

## Issue States

Use labels or equivalent project fields with this meaning:

- `status:todo` -> ready to pick up
- `status:in-progress` -> actively being implemented
- `status:blocked` -> cannot proceed without an external dependency or decision
- `status:human-review` -> PR is ready and waiting on review
- `status:merge` -> approved and waiting to land
- `status:done` -> merged and complete

If the repo board uses different field names, preserve the meaning above.

## Required Flow

1. Read the issue or PR fully.
2. Restate scope in one durable progress comment before coding.
3. Confirm the baseline behavior before changing code.
4. Implement the smallest change that satisfies the issue.
5. Update any affected docs, references, help text, or contract docs before validation when the feature behavior changed.
6. Run [validation-gates](../validation-gates/SKILL.md) and [acpx-review](../acpx-review/SKILL.md).
7. Commit and push to `main` by default.
8. If PR mode is requested or already exists, update the PR and sweep all review feedback before declaring ready.
9. Update the durable issue or PR comment with validation results and final status.

## Durable Comment Template

Reuse a single comment when possible.

```md
## DaoFlow Workpad

- Scope: <one sentence>
- Branch: <main|branch-name>
- Status: <planning|implementing|blocked|ready-for-review|merging>

### Plan

- [ ] Confirm baseline
- [ ] Implement scoped change
- [ ] Validate locally
- [ ] Commit and push
- [ ] Open or update PR if requested

### Validation

- [ ] `bun run format`
- [ ] `bun run test:unit`
- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run skills:check` if instruction files changed
- [ ] ACPX Gemini review
- [ ] ACPX Claude Code review
- [ ] Changed-surface checks

### Notes

- <key finding or blocker>
```

## PR Rules

- PR flow is optional, not default.
- Use `Closes #<issue-number>` when the PR should close the issue.
- PR titles should describe the shipped outcome, not the activity.
- Treat correctness, security, safety, and CI feedback as blocking until fixed or explicitly answered.
- Re-run validation after every substantive PR fix.

## Blocked Rule

Use `status:blocked` only for real external blockers:

- Missing credentials or secrets
- Missing permissions
- Unclear product decisions that change implementation direction
- Broken third-party dependencies or CI environments you cannot repair from the repo

When blocked, leave a short durable comment with the blocker, why it blocks completion, and the exact action needed to unblock.

## Exit Criteria

The loop is complete only when scope is implemented or explicitly blocked, local validation passes, durable GitHub status is updated, and the required CI state is green for the chosen flow.
