---
description: Run code review using acpx (Gemini and Claude Code agents) before committing
---

# Code Review via acpx

Use `acpx` to run self-reviews through Gemini and Claude Code before committing.

## Prerequisites

- `acpx` installed globally: `npm install -g acpx@latest`, or use `bunx acpx` directly.

## Review Current Change Set

1. Run Gemini review on the current change set:

```bash
acpx --approve-reads --timeout 480 gemini exec "Review the current DaoFlow change set for correctness, security, and best practices. Run git status --short, git diff --stat, git diff --cached --stat, git diff, and git diff --cached to inspect changes."
```

2. Run Claude Code review on the current change set:

```bash
acpx --approve-reads --timeout 480 claude exec "Review the current DaoFlow change set for correctness and security. Run git status --short, git diff --stat, git diff --cached --stat, git diff, and git diff --cached to inspect changes."
```

3. If you are intentionally reviewing already-committed work instead of the current diff, adapt the prompt to target that exact commit range.

## Review Specific Files

```bash
acpx --approve-reads --timeout 480 gemini exec "Review <file_path> for correctness, security, and best practices."
acpx --approve-reads --timeout 480 claude exec "Review <file_path> for correctness and security."
```

## Key Flags

| Flag              | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `--approve-reads` | Auto-approve read/search requests, prompt for writes         |
| `--approve-all`   | Auto-approve all permission requests                         |
| `--timeout <s>`   | Max time to wait for response; use `480` for DaoFlow reviews |
| `--format text`   | Output format: text, json, quiet                             |
| `exec`            | One-shot prompt without saved session                        |

## Available Agents

`gemini`, `codex`, `claude`, `cursor`, `copilot`, `openclaw`, `pi`, `droid`, `kiro`, `opencode`, `qwen`

## Notes

- `--approve-reads` goes on the parent `acpx` command, NOT on the subcommand
- `exec` runs a one-shot prompt without creating a persistent session
- Both Gemini and Claude Code can read files and run git commands to inspect the active diff
- Use this before every significant commit for self-review
