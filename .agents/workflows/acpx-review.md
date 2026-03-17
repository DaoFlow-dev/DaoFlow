---
description: Run code review using acpx (Gemini and Codex agents) before committing
---

# Code Review via acpx

Use `acpx` to run self-reviews through Gemini and Codex agents before committing.

## Prerequisites

- `acpx` installed globally: `npm install -g acpx@latest`, or use `bunx acpx` directly.

## Review Recent Changes

// turbo-all

1. Run Gemini review on recent commits:

```bash
acpx --approve-reads --timeout 120 gemini exec "Review the last 3 git commits for correctness, security, and best practices. Run git log -3 --oneline and git diff HEAD~3 to see changes."
```

2. Run Codex review on recent commits:

```bash
acpx --approve-reads --timeout 120 codex exec "Review the last 3 git commits for correctness and security. Run git log -3 --oneline and git diff HEAD~3 to see changes."
```

## Review Specific Files

```bash
acpx --approve-reads --timeout 120 gemini exec "Review <file_path> for correctness, security, and best practices."
acpx --approve-reads --timeout 120 codex exec "Review <file_path> for correctness and security."
```

## Key Flags

| Flag              | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `--approve-reads` | Auto-approve read/search requests, prompt for writes |
| `--approve-all`   | Auto-approve all permission requests                 |
| `--timeout <s>`   | Max time to wait for response (default: 120s)        |
| `--format text`   | Output format: text, json, quiet                     |
| `exec`            | One-shot prompt without saved session                |

## Available Agents

`gemini`, `codex`, `claude`, `cursor`, `copilot`, `openclaw`, `pi`, `droid`, `kiro`, `opencode`, `qwen`

## Notes

- `--approve-reads` goes on the parent `acpx` command, NOT on the subcommand
- `exec` runs a one-shot prompt without creating a persistent session
- Both Gemini and Codex can read files and run git commands to inspect changes
- Use this before every significant commit for self-review
