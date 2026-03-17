---
description: Run format, lint, typecheck, and optionally build before committing and pushing code changes
---

# Pre-Commit Workflow

Run this workflow **before every `git commit` and `git push`** to ensure code quality and prevent CI failures.

## Steps

// turbo-all

1. **Format** — auto-fix formatting issues:

   ```bash
   bun run format
   ```

2. **Lint** — check for code quality issues (must be **0 errors**; warnings are acceptable):

   ```bash
   bun run lint 2>&1 | grep -E "(error|✖)" | tail -5
   ```

   - If there are errors, fix them before proceeding.

3. **Typecheck** — run type checking across all packages:

   ```bash
   bunx tsc --noEmit
   ```

   - Empty output = clean. Any output means type errors that must be fixed.
   - Note: CI uses `tsc -b` (project references mode), which may catch additional issues. If local `--noEmit` passes but CI fails, use `tsc -b packages/shared packages/server packages/client packages/cli` instead.

4. **Code Review** — use Gemini MCP (always) and Codex MCP (for large/challenging changes):
   - **Gemini review** (mandatory for all changes): Use `mcp_gemini-mcp_ask-gemini` to review changed files. Pass the file paths with `@` syntax and ask for a code review focusing on correctness, security, and patterns.
   - **Codex review** (for large/challenging changes): Use `mcp_codex-mcp_codex` for a deeper review when the changeset is substantial or involves complex logic.
   - Fix any issues found before proceeding to commit.

5. **Stage and commit** — use conventional commits:

   ```bash
   git add -A
   git status --short
   git commit -m "type(scope): description"
   ```

   - Follow conventional commits: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

6. **Push** to remote:

   ```bash
   git push origin main
   ```

7. **Wait for CI** — check GitHub Actions status:

   ```bash
   sleep 60 && gh run list --limit 2 --json databaseId,status,conclusion,name
   ```

   - Wait until both `CI` and `Build & Push Docker Image` show `conclusion: "success"`.
   - If CI fails, check logs with `gh run view <RUN_ID> --log-failed 2>&1 | tail -30`, fix, and repeat from step 1.

## Quick Reference

| Gate      | Command                            | Pass Criteria           |
| --------- | ---------------------------------- | ----------------------- |
| Format    | `bun run format`                   | No reformatted files    |
| Lint      | `bun run lint`                     | 0 errors                |
| Typecheck | `bunx tsc --noEmit`                | Empty output            |
| Review    | Gemini MCP (+ Codex for big diffs) | No blocking issues      |
| CI        | `gh run list --limit 2 --json ...` | `conclusion: "success"` |
