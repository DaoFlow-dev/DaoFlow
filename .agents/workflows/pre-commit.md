---
description: Run format, tests, lint, typecheck, and acpx review before committing and pushing code changes
---

# Pre-Commit Workflow

Run this workflow **before every `git commit` and `git push`** to ensure code quality and prevent CI failures.

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
   bunx tsc --noEmit
   ```

   - Empty output = clean. Any output means type errors that must be fixed.
   - Note: CI uses `tsc -b` (project references mode), which may catch additional issues. If local `--noEmit` passes but CI fails, use `tsc -b packages/shared packages/server packages/client packages/cli` instead.

5. **Code Review** — run the ACPX review workflow before commit:

   ```bash
   acpx --approve-reads --timeout 120 gemini exec "Review the last 3 git commits for correctness, security, and best practices. Run git log -3 --oneline and git diff HEAD~3 to see changes."
   acpx --approve-reads --timeout 120 codex exec "Review the last 3 git commits for correctness and security. Run git log -3 --oneline and git diff HEAD~3 to see changes."
   ```

   - Follow `.agents/workflows/acpx-review.md`.
   - If `acpx` is not available globally, use `bunx acpx` instead.
   - Fix blocking issues found in review before proceeding to commit.

6. **Stage and commit** — use conventional commits:

   ```bash
   git add -A
   git status --short
   git commit -m "type(scope): description"
   ```

   - Follow conventional commits: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

7. **Push** to remote:

   ```bash
   git push origin main
   ```

8. **Wait for CI** — check GitHub Actions status:

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
| Typecheck | `bunx tsc --noEmit`                | Empty output               |
| Review    | `acpx` Gemini + Codex review       | No blocking issues         |
| CI        | `gh run list --limit 2 --json ...` | `conclusion: "success"`    |
