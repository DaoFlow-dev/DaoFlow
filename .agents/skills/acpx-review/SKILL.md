---
name: acpx-review
description: Use before DaoFlow commits when running self-review through acpx with Gemini and Claude Code, triaging blocking findings, and revalidating fixes.
---

# ACPX Review

Use this skill before every significant DaoFlow commit.

## Preconditions

- Local validation is already green or close to green.
- `acpx` is available globally, or use `bunx acpx`.
- Review the current change set unless you intentionally need a specific commit range.

## Commands

Run:

```bash
acpx --approve-reads --timeout 480 gemini exec "Review the current DaoFlow change set for correctness, security, and best practices. Run git status --short, git diff --stat, git diff --cached --stat, git diff, and git diff --cached to inspect changes."
acpx --approve-reads --timeout 480 claude exec "Review the current DaoFlow change set for correctness and security. Run git status --short, git diff --stat, git diff --cached --stat, git diff, and git diff --cached to inspect changes."
```

If `acpx` is not available globally, replace it with `bunx acpx`.

## Review Contract

- Treat correctness, security, safety, auth, and data-loss regressions as blocking.
- Fix blocking findings before commit.
- Re-run relevant validation after substantive fixes.
- Keep a short note of the findings you fixed or explicitly rejected.
- When you need a file-specific review, adapt the prompt to the exact files or diff under discussion.

## Reference

Use [.agents/workflows/acpx-review.md](../../workflows/acpx-review.md) for command variants and flag details.
