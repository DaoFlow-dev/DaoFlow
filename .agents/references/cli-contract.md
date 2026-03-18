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

## Identity Contract

- `daoflow login --token <value>` must accept both Better Auth session tokens and DaoFlow API tokens
- When the stored token starts with `dfl_`, the CLI must send `Authorization: Bearer <token>`
- Otherwise the CLI must send `Cookie: better-auth.session_token=<token>`
- Environment-based auth override requires both `DAOFLOW_URL` and `DAOFLOW_TOKEN`; partial overrides must fail closed
- `daoflow login --json` must never block on stdin; if SSO requires manual completion it must return a structured error payload instead
- `daoflow whoami --json` success shape:
  - `{ "ok": true, "data": { "principal": { "id": string, "email": string, "name": string | null, "type": "user" | "service" | "agent", "linkedUserId": string | null }, "role": string, "scopes": string[], "authMethod": "session" | "api-token", "token": { "id": string, "name": string, "prefix": string, "expiresAt": string | null, "scopes": string[] } | null, "session": { "id": string, "expiresAt": string } | null } }`
- `daoflow capabilities --json` success shape:
  - `{ "ok": true, "data": { "authMethod": "session" | "api-token", "role": string, "scopes": string[], "token": { "id": string, "name": string, "prefix": string, "expiresAt": string | null, "scopes": string[] } | null, "total": number } }`

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
| `diff`           | planning | `deploy:read`                        | no       |
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

## Plan Command Contract

- `daoflow plan` is a planning-lane command backed by the control plane, not a local CLI stub
- One target is required:
  - `--service <id|name>` for registered-service planning through `deploymentPlan`
  - `--compose <path>` for direct compose planning through `composeDeploymentPlan`
- Optional input:
  - Service plan: `--server <id|name>`, `--image <ref>`, `--json`
  - Compose plan: `--context <path>`, `--server <id|name>`, `--json`
- JSON service success shape:
  - `{ "ok": true, "data": { "isReady": boolean, "service": {...}, "target": {...}, "currentDeployment": {...} | null, "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } }`
- JSON compose success shape:
  - `{ "ok": true, "data": { "isReady": boolean, "deploymentSource": "uploaded-context" | "uploaded-compose", "project": { "id": string | null, "name": string, "action": "reuse" | "create" }, "environment": { "id": string | null, "name": string, "action": "reuse" | "create" }, "service": { "id": string | null, "name": string, "action": "reuse" | "create", "sourceType": "compose" }, "target": { "serverId": string, "serverName": string, "serverHost": string, "composePath": string | null, "contextPath": string | null, "requiresContextUpload": boolean, "localBuildContexts": [{ "serviceName": string, "context": string, "dockerfile": string | null }], "contextBundle": { "fileCount": number, "sizeBytes": number, "includedOverrides": string[] } | null }, "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } }`
- Human output must show:
  - service or compose scope, project, environment, target server
  - target image for service plans
  - local build-context and bundle details for compose plans
  - current deployment status when present for service plans
  - ordered planned steps
  - preflight checks with `ok` / `warn` / `fail`

## Deploy Dry-Run Contract

- `daoflow deploy --service <id> --dry-run` must use the planning lane `deploymentPlan` route
- `daoflow deploy --compose <path> --dry-run` must use the planning lane `composeDeploymentPlan` route
- Service dry-run scope: `deploy:read`
- Compose dry-run scope: `deploy:read`
- Service execution scope: `deploy:start`
- JSON service dry-run shape:
  - `{ "ok": true, "data": { "dryRun": true, "plan": { "isReady": boolean, "service": {...}, "target": {...}, "currentDeployment": {...} | null, "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } } }`
- JSON compose dry-run shape:
  - `{ "ok": true, "data": { "dryRun": true, "plan": { "isReady": boolean, "deploymentSource": "uploaded-context" | "uploaded-compose", "project": { "id": string | null, "name": string, "action": "reuse" | "create" }, "environment": { "id": string | null, "name": string, "action": "reuse" | "create" }, "service": { "id": string | null, "name": string, "action": "reuse" | "create", "sourceType": "compose" }, "target": { "serverId": string, "serverName": string, "serverHost": string, "composePath": string | null, "contextPath": string | null, "requiresContextUpload": boolean, "localBuildContexts": [{ "serviceName": string, "context": string, "dockerfile": string | null }], "contextBundle": { "fileCount": number, "sizeBytes": number, "includedOverrides": string[] } | null }, "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } } }`

## Rollback Dry-Run Contract

- `daoflow rollback --dry-run` must use the planning lane, not a locally fabricated preview
- Dry-run scope: `deploy:read`
- Execute scope: `deploy:rollback`
- Target flags: `--target <deployment-id>` and `--to <deployment-id>` must behave identically
- JSON dry-run shape:
  - `{ "ok": true, "data": { "dryRun": true, "plan": { "isReady": boolean, "service": {...}, "currentDeployment": {...} | null, "targetDeployment": {...} | null, "availableTargets": [{ "deploymentId": string, "serviceName": string, "sourceType": string, "commitSha": string | null, "imageTag": string | null, "concludedAt": string | null, "status": string }], "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } } }`

## Diff Contract

- `daoflow diff` is a planning-lane comparison backed by the control plane `configDiff` route
- Required input: `--a <deployment-id>`, `--b <deployment-id>`
- Scope: `deploy:read`
- JSON success shape:
  - `{ "ok": true, "data": { "a": {...}, "b": {...}, "summary": { "sameProject": boolean, "sameEnvironment": boolean, "sameService": boolean, "changedScalarCount": number, "changedSnapshotKeyCount": number }, "scalarChanges": [{ "key": string, "baseline": unknown, "comparison": unknown }], "snapshotChanges": [{ "key": string, "baseline": unknown, "comparison": unknown }] } }`
- Human output must show:
  - baseline and comparison deployment identity, project, environment, service, status, commit, image, and target server
  - warnings when the deployments span different projects, environments, or services
  - scalar field changes before snapshot/config changes
