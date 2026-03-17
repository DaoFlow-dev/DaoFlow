---
name: daoflow-github-loop
description: Use when working DaoFlow GitHub Issues end-to-end with Codex, including issue intake, branch setup, implementation, validation, PR handoff, review response, and merge follow-through.
---

# DaoFlow GitHub Loop

Use this skill for DaoFlow's project-wide self-iteration loop: GitHub Issue -> isolated implementation -> validated PR -> review handling -> merge.

## Read First

Before acting, load:

1. Repository root `AGENTS.md`
2. The nearest package-level `AGENTS.md` for files you will edit
3. `.agents/workflows/pre-commit.md`
4. `.agents/workflows/acpx-review.md`

These are the source of truth for repo rules, required validation, and commit/push expectations.

## Loop Contract

- GitHub Issues are the work tracker.
- Use the GitHub CLI `gh` as the default interface for GitHub operations from the terminal.
- Default integration path is direct commit and push to `main`.
- Do not create a feature branch unless the user explicitly requests one or the work is already happening on an existing branch/PR.
- Keep scope tight. If you discover extra work, open a follow-up issue instead of expanding scope.
- Use GitHub comments for durable progress notes; do not rely on ephemeral terminal output.
- Never commit or push with failing local gates or failing CI expectations.

## GitHub Interface

Use `gh` for GitHub interaction unless there is a specific reason to use another interface.

Typical commands:

- `gh issue view <number>` to read issue details
- `gh issue comment <number> --body-file <file>` to update durable progress notes
- `gh issue edit <number> --add-label <label>` to move issue state via labels
- `gh pr view --comments` to inspect review state
- `gh pr create` and `gh pr edit` when PR mode is requested
- `gh run list --limit 2 --json databaseId,status,conclusion,name` to check CI
- `gh run view <RUN_ID> --log-failed` to inspect CI failures

## Issue States

Use labels or equivalent project fields with this meaning:

- `status:todo` -> ready to pick up
- `status:in-progress` -> actively being implemented
- `status:blocked` -> cannot proceed without an external dependency or decision
- `status:human-review` -> PR is ready and waiting on review
- `status:merge` -> approved and waiting to land
- `status:done` -> merged and complete

If the repo project board uses a different field name, preserve the meaning above.

## Required Working Pattern

1. Read the issue fully.
2. Restate scope in a single progress comment before coding.
3. Stay on `main` by default. Only create or switch to a dedicated branch when explicitly requested or when continuing existing branch-based work.
4. Reproduce the problem or confirm the missing behavior before changing code.
5. Implement the smallest change that satisfies the issue.
6. Run the full DaoFlow validation and ACPX review gate from `.agents/workflows/pre-commit.md` and `.agents/workflows/acpx-review.md`.
7. Commit and push to `main` by default.
8. If a PR flow is explicitly requested, open or update a PR that links the issue with `Closes #<issue-number>` when appropriate.
9. Move the issue to `status:human-review` only when a human review or PR review is actually part of the requested flow.
10. Land only after review is addressed and CI is green when operating in PR mode.

## Progress Comment Format

Maintain one durable issue comment and update it as work progresses. Reuse the same comment when possible.

Use this structure:

```md
## Codex Workpad

- Scope: <one sentence>
- Branch: <main|branch-name>
- Status: <planning|implementing|blocked|ready-for-review|merging>

### Plan

- [ ] Reproduce or confirm baseline
- [ ] Implement scoped change
- [ ] Validate locally
- [ ] Commit and push
- [ ] Open/update PR if requested

### Validation

- [ ] `bun run format`
- [ ] `bun run test:unit`
- [ ] `bun run lint`
- [ ] `bunx tsc --noEmit`
- [ ] `acpx` Gemini review
- [ ] `acpx` Codex review
- [ ] Any issue-specific checks

### Notes

- <key finding or blocker>
```

Update the checkboxes as reality changes. Do not leave completed work unchecked.

## Validation Rules

Always run the DaoFlow gates in this order:

1. `bun run format`
2. `bun run test:unit`
3. `bun run lint`
4. `bunx tsc --noEmit`
5. ACPX review via `.agents/workflows/acpx-review.md`

Then run issue-specific checks for the changed surface area.

Before commit or push, follow both:

- `.agents/workflows/pre-commit.md`
- `.agents/workflows/acpx-review.md`

## PR Rules

- PR flow is optional, not default.
- PR title should describe the shipped outcome, not the activity.
- PR body should state:
  - what changed
  - why it changed
  - how it was validated
  - any follow-up issues intentionally deferred
- Include the issue link in the PR body.
- Keep one issue to one PR. If prior PR history is closed or merged, start a fresh branch.

## Review Loop

When a PR already exists or PR mode is requested, do a full feedback sweep before declaring the issue ready:

1. Read top-level PR comments.
2. Read inline review comments.
3. Read review summaries and CI failures.
4. Treat correctness feedback as blocking until fixed or explicitly rebutted.
5. Re-run validation after every substantive fix.

## Blocked Rule

Use `status:blocked` only for real external blockers:

- missing credentials or secrets
- missing permissions
- unclear product decision that changes implementation direction
- broken third-party dependency or CI environment you cannot repair from the repo

When blocked, leave a short issue comment with:

- what is blocked
- why it blocks completion
- exact action needed to unblock

## DaoFlow-Specific Guardrails

- Prefer durable, typed primitives over ad-hoc shortcuts.
- Prefer structured events and explicit records over implicit behavior.
- Preserve agent safety, auditability, and approval boundaries in every change.
- Do not introduce hidden background mutation or ambient authority.
- If a feature increases complexity, justify it in terms of reliability, clarity, backup safety, agent safety, or auditability.

## Principal Engineer Posture

Use this mindset throughout the loop:

- Re-examine the current project with the standards of a top programmer, not just the narrow ticket wording.
- Look for refactoring, simplification, and optimization opportunities that materially improve the current area.
- Do not turn every task into a broad rewrite. Only expand scope when the improvement is tightly coupled to the task and clearly worth it.
- When you choose to refactor or optimize, explain why the change is justified in terms of correctness, maintainability, performance, safety, or operator clarity.
- When a worthwhile improvement is real but out of scope, record it as a follow-up issue instead of silently ignoring it.

Use wording like this when useful:

```md
Re-examine the current project with the mindset of a top programmer. Identify areas in the touched surface that deserve refactoring or optimization, complete the work that is justified for this task, and explain why those changes are worth making.
```

## Exit Criteria

The loop is complete only when all of these are true:

- issue scope is implemented or explicitly blocked
- local validation passes
- commit has been created and pushed to `main`, unless branch/PR mode was explicitly requested
- PR exists or has been updated when operating in PR mode
- issue comment reflects final status
- review feedback has been addressed or explicitly answered when operating in PR mode
- ACPX Gemini and Codex review have been run before commit/push
- CI is green before merge in PR mode, or green after push when working directly on `main`

If the task is merged, mark the issue `status:done`.
