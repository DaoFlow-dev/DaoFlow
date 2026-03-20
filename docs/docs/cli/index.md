---
sidebar_position: 1
---

# CLI Reference

The DaoFlow CLI is the primary interface for AI agents and power users. Every command supports structured JSON output for machine consumption.

## Generated Contract Artifact

The published CLI contract is generated from the live Commander program and committed as a static artifact:

- [`cli-contract.json`](/contracts/cli-contract.json) — command inventory, subcommands, options, documented scope requirements, and machine-readable example payloads

Generate it with `bun run contracts:generate` and validate it with `bun run contracts:check`.

## Installation

```bash
# One-line install (auto-detects OS and architecture)
curl -fsSL -o /usr/local/bin/daoflow \
  https://github.com/DaoFlow-dev/DaoFlow/releases/latest/download/daoflow-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
chmod +x /usr/local/bin/daoflow

# Or build from source
cd packages/cli && bun run build && bun link
```

## Global Flags

Every command accepts these flags:

| Flag                  | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `--json`              | Output structured JSON to stdout (progress/errors to stderr) |
| `--quiet` / `-q`      | Bare value output only (just the ID, just the URL)           |
| `--dry-run`           | Preview changes without executing (mutating commands only)   |
| `--yes`               | Skip confirmation prompts (required for mutating commands)   |
| `--timeout <seconds>` | Request timeout (default: 30)                                |
| `--idempotency-key`   | Prevent duplicate operations                                 |
| `--help`              | Show command help with examples and required scopes          |
| `--version`           | Show CLI version                                             |

## Output Contract

- **Without `--json`**: Human-readable tables and prose to stdout
- **With `--json`**: Structured JSON to stdout, progress to stderr
- Every JSON response includes `{ "ok": true/false }` at the top level
- Errors include `{ "ok": false, "error": "message", "code": "ERROR_CODE", "requiredScope": "..." }`

## Exit Codes

| Code | Meaning                        |
| ---- | ------------------------------ |
| `0`  | Success                        |
| `1`  | General error                  |
| `2`  | Permission denied              |
| `3`  | Dry-run completed (no changes) |

## Command Overview

| Command                          | Lane         | Scope Required             | Mutating |
| -------------------------------- | ------------ | -------------------------- | -------- |
| [`login`](./auth)                | —            | none (creates session)     | yes      |
| [`whoami`](./whoami)             | read         | any valid token            | no       |
| [`capabilities`](./capabilities) | read         | any valid token            | no       |
| [`status`](./status)             | read         | `server:read`              | no       |
| [`server add`](./server)         | command      | `server:write`             | yes      |
| `services`                       | read         | `service:read`             | no       |
| `projects`                       | read         | `deploy:read`              | no       |
| [`deploy`](./deploy)             | command      | `deploy:start`             | yes      |
| [`rollback`](./rollback)         | command      | `deploy:rollback`          | yes      |
| [`diff`](./diff)                 | planning     | `deploy:read`              | no       |
| [`logs`](./logs)                 | read         | `logs:read`                | no       |
| [`env`](./env)                   | read/command | `env:read` / `env:write`   | varies   |
| [`plan`](./plan)                 | planning     | `deploy:read`              | no       |
| [`doctor`](./doctor)             | read         | `server:read`, `logs:read` | no       |
| `backup list`                    | read         | `backup:read`              | no       |
| `backup run`                     | command      | `backup:run`               | yes      |
| `backup restore`                 | command      | `backup:restore`           | yes      |

The generated contract includes additional command families not expanded into individual docs pages here, including backup destination management, backup schedule management, token management, config helpers, install/upgrade flows, and update commands.

`backup restore --dry-run` is the exception worth noting: it uses the API planning lane through `backupRestorePlan`, exits with code `3`, and only requires `backup:read`.

## Configuration

The CLI stores configuration in `~/.daoflow/config.json`:

```json
{
  "currentContext": "default",
  "contexts": {
    "default": {
      "apiUrl": "http://localhost:3000",
      "token": "dfl_abc123...",
      "authMethod": "api-token"
    }
  }
}
```

For automation, `DAOFLOW_URL` and `DAOFLOW_TOKEN` can provide a runtime auth context without writing a config file. Set both together; a partial override is treated as an error.

For fresh server installs, `DAOFLOW_INITIAL_ADMIN_EMAIL` and `DAOFLOW_INITIAL_ADMIN_PASSWORD` can preseed the first owner account that `daoflow install` writes into the generated `.env`.
