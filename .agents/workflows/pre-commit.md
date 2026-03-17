---
description: Run format, tests, lint, typecheck, and acpx review before committing and pushing code changes
---

# Pre-Commit Workflow

Run this workflow **before every `git commit` and `git push`** to ensure code quality and prevent CI failures.

The repo installs a Git `pre-commit` hook through `bun install` or `bun run hooks:install`. That hook runs:

- `bun run format`
- `git add -A`
- `bun run lint`
- `bun run typecheck`

Use `DAOFLOW_SKIP_PRECOMMIT=1 git commit ...` only for exceptional recovery cases.

## Steps

// turbo-all

1. **Format** — auto-fix formatting issues:

   ```bash
   bun run format
   ```

2. **Tests** — run the local test suite required before commit/push:

   ```bash
   bun run test:unit
   ```

   - If the change affects a broader surface area, also run any issue-specific tests needed for confidence.

3. **Lint** — check for code quality issues (must be **0 errors**; warnings are acceptable):

   ```bash
   bun run lint 2>&1 | grep -E "(error|✖)" | tail -5
   ```

   - If there are errors, fix them before proceeding.

4. **Typecheck** — run type checking across all packages:

   ```bash
   bun run typecheck
   ```

   - Any output means type errors that must be fixed.

5. **Skills & Instructions** — when the diff touches `AGENTS.md`, `.agents/`, or `.codex/skills/`, validate the instruction surface:

   ```bash
   bun run skills:check
   ```

   - This checks skill frontmatter, repo-local skill metadata, and markdown links in the instruction surface.

6. **Code Review** — run the ACPX review workflow before commit:

   ```bash
   acpx --approve-reads --timeout 480 gemini exec "Review the current DaoFlow change set for correctness, security, and best practices. Run git status --short, git diff --stat, git diff --cached --stat, git diff, and git diff --cached to inspect changes."
   acpx --approve-reads --timeout 480 claude exec "Review the current DaoFlow change set for correctness and security. Run git status --short, git diff --stat, git diff --cached --stat, git diff, and git diff --cached to inspect changes."
   ```

   - Follow `.agents/workflows/acpx-review.md`.
   - If `acpx` is not available globally, use `bunx acpx` instead.
   - Fix blocking issues found in review before proceeding to commit.

7. **Stage and commit** — use conventional commits:

   ```bash
   git add -A
   git status --short
   git commit -m "type(scope): description"
   ```

   - Follow conventional commits: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

8. **Push** to remote:

   ```bash
   git push origin main
   ```

9. **Wait for CI** — check GitHub Actions status:

   ```bash
   sleep 60 && gh run list --limit 2 --json databaseId,status,conclusion,name
   ```

   - Wait until both `CI` and `Build & Push Docker Image` show `conclusion: "success"`.
   - If CI fails, check logs with `gh run view <RUN_ID> --log-failed 2>&1 | tail -30`, fix, and repeat from step 1.

## Quick Reference

| Gate      | Command                            | Pass Criteria              |
| --------- | ---------------------------------- | -------------------------- |
| Format    | `bun run format`                   | Formatting applied cleanly |
| Tests     | `bun run test:unit`                | Tests pass                 |
| Lint      | `bun run lint`                     | 0 errors                   |
| Typecheck | `bun run typecheck`                | Clean typecheck            |
| Skills    | `bun run skills:check`             | Instruction checks pass    |
| Review    | `acpx` Gemini + Claude review      | No blocking issues         |
| CI        | `gh run list --limit 2 --json ...` | `conclusion: "success"`    |
