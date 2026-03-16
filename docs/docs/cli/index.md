---
sidebar_position: 1
---

# CLI Reference

The DaoFlow CLI is the primary interface for AI agents and power users. Every command supports structured JSON output for machine consumption.

## Installation

```bash
# Via Bun
bun add -g @daoflow/cli

# Or build from source
cd packages/cli && bun run build && bun link
```

## Global Flags

Every command accepts these flags:

| Flag | Description |
|------|-------------|
| `--json` | Output structured JSON to stdout (progress/errors to stderr) |
| `--quiet` / `-q` | Bare value output only (just the ID, just the URL) |
| `--timeout <seconds>` | Request timeout (default: 30) |
| `--help` | Show command help with examples |
| `--version` | Show CLI version |

## Output Contract

- **Without `--json`**: Human-readable tables and prose to stdout
- **With `--json`**: Structured JSON to stdout, progress to stderr
- Every JSON response includes `{ "ok": true/false }` at the top level
- Errors include `{ "ok": false, "error": "message", "code": "ERROR_CODE" }`

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Permission denied |
| `3` | Dry-run completed (no changes) |

## Command Overview

| Command | Lane | Scope Required | Mutating |
|---------|------|---------------|----------|
| [`login`](./auth) | — | none | yes |
| [`whoami`](./whoami) | read | any valid token | no |
| [`capabilities`](./capabilities) | read | any valid token | no |
| [`status`](./status) | read | `server:read` | no |
| [`deploy`](./deploy) | command | `deploy:start` | yes |
| [`rollback`](./rollback) | command | `deploy:rollback` | yes |
| [`logs`](./logs) | read | `logs:read` | no |
| [`env`](./env) | read/command | `env:read` / `env:write` | varies |
| [`plan`](./plan) | planning | `deploy:read` | no |
| [`doctor`](./doctor) | read | `server:read`, `logs:read` | no |

## Configuration

The CLI stores configuration in `~/.daoflow/config.json`:

```json
{
  "apiUrl": "http://localhost:3000",
  "token": "dfl_abc123...",
  "defaultProject": "my-web-app",
  "defaultEnvironment": "production"
}
```
