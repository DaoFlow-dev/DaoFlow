# @daoflow/cli — Agent Rules

## Vision

The CLI is the **primary interface for AI agents** to operate DaoFlow. Every command is designed for non-human operators from the start, while remaining ergonomic for humans.

An AI coding agent should be able to:

1. Authenticate with a scoped token
2. Inspect infrastructure state, logs, and deployment history
3. Generate deployment plans and rollback strategies
4. Execute deployments within its granted permissions
5. Diagnose failures and recommend actions
6. Never accidentally break production

## Build

- Run `bun run typecheck` before committing.
- Build binaries with `bun run build` (or platform-specific variants).
- Built binaries go to `dist/` which is gitignored.
- Test compiled binary: `./dist/daoflow --help`.

## Architecture

```
src/
├── index.ts          # Entry point — registers all commands with Commander
├── api-client.ts     # Fetch-based API client with auth headers
├── config.ts         # Token storage (~/.daoflow/config.json)
└── commands/
    ├── login.ts      # Authenticate and store token
    ├── status.ts     # Server health and Docker version
    ├── doctor.ts     # Full connectivity diagnostics
    ├── services.ts   # List running services
    ├── projects.ts   # List projects
    ├── deploy.ts     # Deploy from compose/image/Dockerfile
    ├── push.ts       # Push and deploy
    ├── plan.ts       # Generate deployment plan (read-only)
    ├── rollback.ts   # Roll back to previous deployment
    ├── logs.ts       # Stream deployment and container logs
    └── env.ts        # Environment variable management
```

## Commands

- Each command lives in `src/commands/<name>.ts`.
- Commands export a factory function returning a `Command` instance.
- Always handle errors gracefully with user-friendly messages via `chalk.red()`.
- Use `ora` spinners for long-running operations.
- Every command must support `--json` for structured output.
- Every mutating command must support `--dry-run` and `--yes`.

## Output Contract

```
# Human mode (default)
daoflow status
→ Human-readable table to stdout

# Agent mode (--json)
daoflow status --json
→ JSON to stdout, progress/errors to stderr
```

Every JSON response must follow this shape:

```json
{
  "ok": true,
  "data": { ... }
}
```

Error responses:

```json
{
  "ok": false,
  "error": "Permission denied",
  "code": "SCOPE_DENIED",
  "requiredScope": "deploy:start"
}
```

### Exit Codes

| Code | Meaning           |
| ---- | ----------------- |
| 0    | Success           |
| 1    | Error             |
| 2    | Permission denied |
| 3    | Dry-run completed |

## Permission Scope Map

Every command checks scopes before making API calls. This table is the source of truth:

| Command          | Lane     | Required Scope(s)                    | Mutating |
| ---------------- | -------- | ------------------------------------ | -------- |
| `login`          | —        | none (creates session)               | yes      |
| `whoami`         | read     | any valid token                      | no       |
| `capabilities`   | read     | any valid token                      | no       |
| `status`         | read     | `server:read`                        | no       |
| `services`       | read     | `service:read`                       | no       |
| `projects`       | read     | `deploy:read`                        | no       |
| `logs`           | read     | `logs:read`                          | no       |
| `plan`           | planning | `deploy:read`                        | no       |
| `doctor`         | read     | `server:read`, `logs:read`           | no       |
| `deploy`         | command  | `deploy:start`                       | yes      |
| `push`           | command  | `deploy:start`                       | yes      |
| `rollback`       | command  | `deploy:rollback`                    | yes      |
| `env list`       | read     | `env:read`                           | no       |
| `env set`        | command  | `env:write`                          | yes      |
| `env delete`     | command  | `env:write`                          | yes      |
| `backup list`    | read     | `backup:read`                        | no       |
| `backup run`     | command  | `backup:run`                         | yes      |
| `backup restore` | command  | `backup:restore`, `approvals:create` | yes      |

## Security Invariants

1. **Never interpolate** user-provided values into shell commands.
2. **Validate all inputs** — reject shell metacharacters, path traversals, control characters.
3. **Truncate** excessively long inputs with a clear structured error.
4. **Per-command token validation** — never cache elevated permissions beyond a single invocation.
5. **Structured permission denied** — when a scope check fails, emit `{ "ok": false, "code": "SCOPE_DENIED", "requiredScope": "..." }`.
6. **`--dry-run` is read-only** — must work even with read-only tokens.
7. **`--yes` is required for mutation** — destructive commands must prompt or require `--yes`.
8. **Idempotency keys** — all write commands must accept `--idempotency-key`.

## API Client

- `src/api-client.ts` wraps `fetch()` for the DaoFlow API.
- Auth tokens are stored via `src/config.ts` in `~/.daoflow/config.json`.
- Always include error handling for network failures and auth expiry.
- Include `X-Idempotency-Key` header when provided.
- Timeouts must be configurable via `--timeout` flag (default: 30s).

## Code Style

- Use `import type` for type-only imports.
- Prefer `commander`'s built-in argument parsing over manual `process.argv`.
- Keep commands focused — one responsibility per command file.
- Use structured output (tables, JSON) that agents can parse.
- Keep `--help` output comprehensive: show required scopes, examples, and JSON shape.

## Adding New Commands

When adding a new command:

1. Create `src/commands/<name>.ts` exporting a factory function
2. Add `--json`, `--dry-run`, `--yes` flags as appropriate (see scope map above)
3. Add the command to `src/index.ts`
4. Add a row to the Permission Scope Map in this file
5. Add E2E test coverage in `e2e/` matching the scope and lane
6. Update `packages/shared/src/authz.ts` if new scopes are needed
