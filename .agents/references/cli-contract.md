# DaoFlow CLI Contract

This file holds the detailed CLI contract, scope map, and agent-facing command rules that were previously embedded in the root `AGENTS.md`.

## Output Contract

- Every command must support `--json`
- Structured JSON goes to stdout; progress and prose go to stderr when possible
- JSON output must use flat keys, consistent field names, and ISO 8601 timestamps
- Every JSON response must include `{ "ok": true/false }` at the top level
- Error responses must include `{ "ok": false, "error": "message", "code": "SCOPE_DENIED", "requiredScope": "deploy:start" }`

## Self-Documenting Commands

- `--help` on every command must show required parameters, optional flags, required scope, example usage, and example JSON shape
- `daoflow capabilities` must list all available scopes for the current token
- `daoflow whoami` must show current principal, role, and granted scopes

## Composability

- Support `--quiet` / `-q` for bare value output
- Support stdin for batch operations where appropriate
- Commands must be idempotent where possible
- All write commands must accept `--idempotency-key`

## Adversarial Input Safety

- Validate all agent-provided values before sending to the API
- Reject shell metacharacters, path traversal patterns, and control characters
- Truncate excessively long inputs with a clear error message
- Never interpolate user input into shell commands

## Permission Enforcement

- Every command checks scopes before making API calls
- Permission denied errors must tell the agent the exact scope it needs
- The CLI must never cache elevated permissions beyond a single command invocation
- `--dry-run` must work with read-only tokens

## Command Scope Map

| Command          | Lane     | Required Scope(s)                    | Mutating |
| ---------------- | -------- | ------------------------------------ | -------- |
| `login`          | session  | none                                 | yes      |
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
