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
- `daoflow login --email <email> --password <password>` must return `MFA_REQUIRED` instead of storing a partial session when the server asks for a second factor
- `daoflow login --email <email> --password <password> --totp-code <code>` must complete TOTP-protected login
- `daoflow login --email <email> --password <password> --recovery-code <code>` must complete recovery-code login and let Better Auth consume that code server-side
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
- `--quiet` should print the primary machine-consumable value for the command without prose when a single value is available
- Support stdin for batch operations where appropriate
- Commands must be idempotent where possible
- All write commands must accept `--idempotency-key`
- All networked commands must honor the global `--timeout <seconds>` budget

## Global Automation Flags

- `--json` returns the standard `{ "ok": true|false }` envelope on stdout
- `--quiet` suppresses prose and prints the command's primary scalar value or one value per line
- `--timeout <seconds>` applies to CLI network calls across read, planning, and command lanes
- `--idempotency-key <key>` is forwarded on write requests so retries can be replay-safe

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

| Command              | Lane                  | Required Scope(s)                               | Mutating |
| -------------------- | --------------------- | ----------------------------------------------- | -------- |
| `login`              | session               | none                                            | yes      |
| `whoami`             | read                  | any valid token                                 | no       |
| `capabilities`       | read                  | any valid token                                 | no       |
| `audit`              | read                  | any valid token                                 | no       |
| `approvals`          | read/command          | any valid token, `approvals:decide`             | varies   |
| `status`             | read                  | `server:read`                                   | no       |
| `server add`         | command               | `server:write`                                  | yes      |
| `server proxy`       | command               | `server:write`                                  | yes      |
| `server ops`         | read/command          | `server:read`, `server:write`                   | varies   |
| `tunnels`            | read/command          | `server:read`, `server:write`                   | varies   |
| `log-drains`         | read/command          | `server:read`, `server:write`                   | varies   |
| `access-assets`      | read/command          | `server:read`, `server:write`                   | varies   |
| `maintenance`        | read/command          | `server:write`                                  | varies   |
| `terminal service`   | command               | `terminal:open`                                 | yes      |
| `services`           | read/command          | `service:read`, `service:update`                | varies   |
| `projects`           | read/command          | `deploy:read`, `deploy:start`, `service:update` | varies   |
| `templates`          | read/planning/command | none, `deploy:read`, `deploy:start`             | varies   |
| `logs`               | read                  | `logs:read`                                     | no       |
| `plan`               | planning              | `deploy:read`                                   | no       |
| `diff`               | planning              | `deploy:read`                                   | no       |
| `doctor`             | read                  | `server:read`, `logs:read`                      | no       |
| `install`            | local                 | none                                            | yes      |
| `upgrade`            | local                 | none                                            | yes      |
| `uninstall`          | local                 | none                                            | yes      |
| `deploy`             | command               | `deploy:start`                                  | yes      |
| `push`               | command               | `deploy:start`                                  | yes      |
| `rollback`           | command               | `deploy:rollback`                               | yes      |
| `env list`           | read                  | `env:read`                                      | no       |
| `env set`            | command               | `env:write`                                     | yes      |
| `env delete`         | command               | `env:write`                                     | yes      |
| `volumes list`       | read                  | `volumes:read`                                  | no       |
| `volumes register`   | command               | `volumes:write`                                 | yes      |
| `volumes update`     | command               | `volumes:write`                                 | yes      |
| `volumes delete`     | command               | `volumes:write`                                 | yes      |
| `backup list`        | read                  | `backup:read`                                   | no       |
| `backup policy`      | command               | `backup:run`                                    | yes      |
| `backup run`         | command               | `backup:run`                                    | yes      |
| `backup restore`     | command               | `backup:restore`                                | yes      |
| `notifications list` | read                  | any valid token                                 | no       |
| `notifications logs` | read                  | any valid token                                 | no       |

- `daoflow backup restore --dry-run` is a planning-lane preview backed by `backupRestorePlan` and requires only `backup:read`
- `daoflow backup restore --yes` queues the restore and requires `backup:restore`
- If an operator wants a human approval gate before restore execution, create a separate `requestApproval` with `approvals:create`

## Compose Drift Contract

- `daoflow drift` reads the caller team's Compose drift records and requires `deploy:read`.
- This containment phase does **not** inspect a Docker host. Every report is `authoritative: false` and has `source: "cached-snapshot"` or `source: "unavailable"`; `source: "live"` is not emitted.
- Every report includes `attemptedAt`, `observedAt`, `maxAgeSeconds`, `target`, and `evidenceRefs`. Timestamps may be `null` when no stored snapshot exists.
- A legacy stored `aligned` value is returned as `status: "unavailable"`; an uninspected or unreachable host must never be reported as aligned.
- Stable JSON success shape:
  - `{ "ok": true, "data": { "inspection": { "availability": "not-implemented", "blockers": string[], "limits": { "minimumIntervalSeconds": number, "maxConcurrentPerServer": number } }, "summary": { "totalServices": number, "cachedSnapshotServices": number, "unavailableServices": number, "driftedServices": number, "blockedServices": number, "reviewRequired": number }, "reports": [{ "source": "cached-snapshot" | "unavailable", "authoritative": false, "attemptedAt": string | null, "observedAt": string | null, "maxAgeSeconds": number, "target": { "serverId": string | null, "serverName": string | null, "composeProjectName": string | null }, "evidenceRefs": string[] }] } }`
- Live inspection remains blocked on #230 (strict SSH identity) and #233 (DaoFlow-owned resource selection). Its reserved safety profile is one concurrent check per server, at least 60 seconds between checks, normalized evidence IDs only, and no raw `docker inspect` output or secret-bearing environment values persisted.

## Volume Registry Contract

- `daoflow volumes list` reads the persistent volume registry through `persistentVolumes`
- Scope: `volumes:read`
- `daoflow volumes register --dry-run` must return a local preview and exit with code `3`
- `daoflow volumes register --yes` writes through `createVolume` and requires `volumes:write`
- `daoflow volumes update --dry-run` must return a local preview and exit with code `3`
- `daoflow volumes update --yes` writes through `updateVolume` and requires `volumes:write`
- `daoflow volumes delete --dry-run` must return a local preview and exit with code `3`
- `daoflow volumes delete --yes` writes through `deleteVolume` and requires `volumes:write`
- JSON list success shape:
  - `{ "ok": true, "data": { "summary": { "totalVolumes": number, "protectedVolumes": number, "attentionVolumes": number, "attachedBytes": number }, "volumes": [{ "id": string, "serverId": string, "projectId": string, "environmentId": string, "serviceId": string | null, "volumeName": string, "mountPath": string, "driver": string, "status": string, "backupPolicyId": string | null, "backupCoverage": string, "restoreReadiness": string, "statusTone": string, "createdAt": string, "updatedAt": string }] } }`
- JSON mutation success shapes:
  - `volumes register|update`: `{ "ok": true, "data": { "volume": { "id": string, "name": string, "serverId": string, "mountPath": string, "status": string } } }`
  - `volumes delete`: `{ "ok": true, "data": { "deleted": true, "volumeId": string } }`

## Backup Policy Contract

- `daoflow backup list` remains the read path for policy inventory plus recent runs
- `daoflow backup policy create --dry-run` must return a local preview and exit with code `3`
- `daoflow backup policy create --yes` writes through `createBackupPolicy` and requires `backup:run`
- `daoflow backup policy update --dry-run` must return a local preview and exit with code `3`
- `daoflow backup policy update --yes` writes through `updateBackupPolicy` and requires `backup:run`
- `daoflow backup policy delete --dry-run` must return a local preview and exit with code `3`
- `daoflow backup policy delete --yes` writes through `deleteBackupPolicy` and requires `backup:run`
- One registered volume maps to one backup policy today so the coverage metadata stays stable and agent-readable
- JSON mutation success shapes:
  - `backup policy create|update`: `{ "ok": true, "data": { "policy": { "id": string, "name": string, "volumeId": string, "destinationId": string | null, "backupType": "volume" | "database", "schedule": string | null, "retentionDays": number, "status": string } } }`
  - `backup policy delete`: `{ "ok": true, "data": { "deleted": true, "policyId": string } }`

## Environment Variable Contract

- `daoflow env list` reads the caller-team environment variable inventory through `environmentVariables`
- Scope: `env:read`
- Secret visibility:
  - secret values stay masked by default
  - callers who also have `secrets:read` may receive revealed secret values in interactive inventory reads
  - `daoflow env pull` remains a redacted export and must still write secret placeholders instead of raw secret values
- Audit contract:
  - `env set` and `env delete` must emit audit entries with redacted before/after metadata
  - audit detail must explain what changed without leaking secret payloads

## Services Contract

- `daoflow services` reads the authenticated service inventory instead of the compose release catalog
- Scope: `service:read`
- Optional input:
  - `--project <id>` to scope through `projectServices`
  - `--json`
- JSON success shape:
  - `{ "ok": true, "data": { "projectId": string | null, "services": [{ "id": string, "name": string, "projectName": string | null, "environmentName": string | null, "sourceType": string, "status": string, "statusTone": string, "statusLabel": string, "runtimeSummary": { "status": "not-deployed" | "last-known-healthy" | "rollout-in-progress" | "attention", "statusLabel": string, "statusTone": string, "summary": string, "observedAt": string | null }, "rolloutStrategy": { "key": "compose-recreate" | "container-replace", "label": string, "summary": string, "downtimeRisk": "possible" | "expected", "supportsZeroDowntime": boolean, "healthGate": "readiness-probe" | "docker-health" | "container-health" }, "latestDeployment": { "id": string, "status": string, "statusLabel": string, "statusTone": string, "summary": string, "commitSha": string | null, "imageTag": string | null, "targetServerId": string, "targetServerName": string | null, "createdAt": string, "finishedAt": string | null } | null }] } }`
- Human output must show:
  - service name
  - runtime status derived from the latest known rollout
  - rollout strategy and whether downtime is still possible
  - target server and current image when available
  - a summary line explaining the latest health verdict
- `daoflow services create --dry-run` must return a local preview and exit with code `3`
- `daoflow services create --yes` writes through `createService` and requires `service:update`
- Required input:
  - `--project <id>`
  - `--environment <id>`
  - `--name <name>`
  - `--source-type <compose|dockerfile|image>`
- Optional input:
  - `--compose-service <name>` only when `--source-type compose`
  - `--dockerfile <path>` only when `--source-type dockerfile`
  - `--image <ref>` only when `--source-type image`
  - `--server <id>`
  - `--port <value>`
  - `--healthcheck-path <path>`
  - `--dry-run`
  - `--yes`
  - `--json`
- Source-aware validation:
  - compose services require `--compose-service` and reject `--dockerfile` / `--image`
  - dockerfile services require `--dockerfile` and reject `--compose-service` / `--image`
  - image services require `--image` and reject `--compose-service` / `--dockerfile`
- JSON dry-run shape:
  - `{ "ok": true, "data": { "dryRun": true, "projectId": string, "environmentId": string, "name": string, "sourceType": "compose" | "dockerfile" | "image", "composeServiceName"?: string, "dockerfilePath"?: string, "imageReference"?: string, "targetServerId"?: string, "port"?: string, "healthcheckPath"?: string } }`
- JSON success shape:
  - `{ "ok": true, "data": { "service": { "id": string, "projectId": string, "environmentId": string, "name": string, "sourceType": "compose" | "dockerfile" | "image", "status": string }, "nextSteps": { "plan": { "command": string, "description": string }, "deploy": { "command": string, "description": string } } } }`
- Human output must show:
  - created service name and id
  - project and environment ids
  - the exact next plan command
  - the exact next deploy command
- `daoflow services domain routing` writes through `updateServiceDomainRouting` and requires `service:update`
- Required input:
  - `--service <id>`
  - `--domain <id>`
  - `--mode <observed|managed-traefik>`
- Optional input:
  - `--target-port <port>`
  - `--dry-run`
  - `--yes`
  - `--json`
- JSON success shape:
  - `{ "ok": true, "data": { "serviceId": string, "domain": { "id": string, "hostname": string, "routingMode": "observed" | "managed-traefik", "targetPort": number | null } | null } }`
- `daoflow services schedules list --service <id>` reads service-scoped schedules through `serviceSchedules`
- `daoflow services schedules runs --schedule <id>` reads run history and logs through `serviceScheduleRuns`
- `daoflow services schedules create --dry-run` returns a local preview and exits with code `3`
- `daoflow services schedules create --yes` writes through `createServiceSchedule` and requires `service:update`
- `daoflow services schedules pause|resume|run|delete --dry-run` returns a local preview and exits with code `3`
- `daoflow services schedules pause|resume|run|delete --yes` writes through the matching service schedule mutation and requires `service:update`
- Required create input:
  - `--service <id>`
  - `--name <name>`
  - `--command <command>`
  - `--cron <expression>`
- Optional create input:
  - `--timezone <zone>`, default `UTC`
  - `--retention <count>`, default server policy
  - `--no-notify-on-failure`
  - `--dry-run`
  - `--yes`
  - `--json`
- JSON schedule shape:
  - `{ "id": string, "serviceId": string, "projectId": string, "environmentId": string, "name": string, "command": string, "cronExpression": string, "timezone": string, "status": string, "enabled": boolean, "nextRunAt": string | null, "lastRunAt": string | null }`
- JSON run shape:
  - `{ "id": string, "scheduleId": string, "serviceId": string, "triggerKind": string, "status": string, "command": string, "logs": string, "error": string | null, "createdAt": string, "finishedAt": string | null }`

## Server Operations Contract

- `daoflow server ops resources` writes a durable `resource_check` operation through `collectServerResources` and requires `server:read`
- `daoflow server ops cleanup --dry-run` writes a durable `cleanup_preview` operation through `previewServerCleanup` and requires `server:write`
- `daoflow server ops cleanup --yes` writes a durable `cleanup_run` operation through `runServerCleanup` and requires a recent successful cleanup preview
- `daoflow server ops patch` writes a durable non-mutating `patch_plan` operation through `planServerPatches` and requires `server:write`
- `daoflow server ops swarm refresh-topology --server <id>` refreshes observed Swarm nodes from the manager and requires `server:write`
- `daoflow server ops swarm node availability --server <id> --node <id|name> --availability <active|pause|drain> --dry-run` records a durable plan without changing the node
- `daoflow server ops swarm node availability --server <id> --node <id|name> --availability <active|pause|drain> --yes` applies `docker node update --availability` through the server operation runtime
- `daoflow server ops swarm service scale --server <id> --service <name> --replicas <n> --dry-run` records a durable scale plan
- `daoflow server ops swarm service scale --server <id> --service <name> --replicas <n> --yes` applies `docker service scale` through the server operation runtime
- `daoflow server ops history` reads `serverOperationsHub` and requires `server:read`
- `daoflow server ops logs --operation <id>` reads `serverOperationLogs` and requires `server:read`
- Host terminal access is web-only in this iteration and uses `/ws/host-terminal` with `terminal:open`

## Maintenance Contract

- `daoflow maintenance report` reads `operationalMaintenanceReport`
- `daoflow maintenance run --dry-run` calls `runOperationalMaintenance` with `dryRun: true`
- `daoflow maintenance run --yes` calls `runOperationalMaintenance` with `dryRun: false`
- Scope: `server:write`
- Live cleanup requires `--yes`; missing confirmation must return `CONFIRMATION_REQUIRED`
- JSON success shapes:
  - report: `{ "ok": true, "data": { "generatedAt": string, "defaults": object, "current": object, "latestRun": object | null } }`
  - run: `{ "ok": true, "data": { "generatedAt": string, "dryRun": boolean, "trigger": "manual" | "monitor", "stalledDeployments": object, "stalePreviews": object, "expiredCliAuthRequests": object, "retainedArtifacts": object, "summary": string } }`

## Terminal Contract

- `daoflow terminal service --service <id>` opens `/ws/docker-terminal` for a running service container
- Scope: `terminal:open`
- Optional input: `--shell <bash|sh>`, default `bash`
- The command must require an interactive TTY and must not accept a one-shot command string
- `--json` is supported only for structured preflight errors; terminal byte streams are not JSON encoded
- Permission failures must include `requiredScope: "terminal:open"` and granted scopes when available
- JSON operation success shape:
  - `{ "ok": true, "data": { "status": "ok", "operation": { "id": string, "serverId": string, "kind": string, "status": string, "dryRun": boolean, "summary": string | null, "createdAt": string, "completedAt": string | null }, "result": unknown } }`

## Managed Tunnels Contract

- `daoflow tunnels list` reads registered tunnel inventory and observed routes through `managedTunnels`
- `daoflow tunnels create --yes` registers a managed tunnel and requires `server:write`
- `daoflow tunnels sync --yes` replaces observed routes for one tunnel and requires `server:write`
- `daoflow tunnels update --yes` updates tunnel metadata and requires `server:write`
- `daoflow tunnels rotate --yes` replaces encrypted tunnel credentials and requires `server:write`
- `daoflow tunnels delete --yes` removes a tunnel and its observed routes and requires `server:write`
- JSON list success shape:
  - `{ "ok": true, "data": { "tunnels": [{ "id": string, "name": string, "teamId": string, "tunnelId": string | null, "domain": string | null, "status": string, "hasCredentials": boolean, "createdAt": string, "updatedAt": string, "routes": [{ "id": string, "hostname": string, "service": string, "path": string | null, "status": string, "createdAt": string, "updatedAt": string }] }] } }`
- JSON mutation success shapes:
  - `tunnels create|sync|update|rotate`: `{ "ok": true, "data": { "tunnel": { "id": string, "name": string, "status": string, "hasCredentials": boolean, "routes": [] } } }`
  - `tunnels delete`: `{ "ok": true, "data": { "deleted": true, "tunnelId": string } }`

## Log Drains Contract

- `daoflow log-drains list` reads configured external log drains through `logDrains`
- `daoflow log-drains deliveries` reads recent delivery attempts through `logDrainDeliveries`
- `daoflow log-drains create --yes` creates a drain and requires `server:write`
- `daoflow log-drains test --yes` sends a test payload and records a delivery attempt
- `daoflow log-drains retry --yes` retries a failed delivery by creating a new delivery row
- `daoflow log-drains delete --yes` deletes a drain and requires `server:write`
- JSON list success shape:
  - `{ "ok": true, "data": { "drains": [{ "id": string, "name": string, "teamId": string, "destinationType": string, "endpointUrl": string, "hasHeaders": boolean, "serviceFilter": string | null, "environmentFilter": string | null, "status": string, "lastDeliveredAt": string | null, "lastError": string | null, "createdAt": string, "updatedAt": string }] } }`
- JSON delivery success shape:
  - `{ "ok": true, "data": { "deliveries": [{ "id": string, "drainId": string, "status": string, "httpStatus": string | null, "payload": object, "responseBody": string | null, "error": string | null, "attemptedAt": string, "completedAt": string | null }] } }`
- JSON mutation success shapes:
  - `log-drains create`: `{ "ok": true, "data": { "drain": { "id": string, "name": string, "status": string } } }`
  - `log-drains test|retry`: `{ "ok": true, "data": { "delivery": { "id": string, "status": "delivered" | "failed", "httpStatus": string | null } } }`
  - `log-drains delete`: `{ "ok": true, "data": { "deleted": true, "drainId": string } }`

## Access Assets Contract

- `daoflow access-assets ssh-key list` reads managed SSH key metadata through `managedSshKeys`
- `daoflow access-assets ssh-key create --yes` encrypts private key material, stores only safe metadata in responses, and requires `server:write`
- `daoflow access-assets ssh-key rotate --yes` replaces encrypted private key material and requires `server:write`
- `daoflow access-assets ssh-key attach --yes` links an existing key to a server and clears any per-server raw key material
- `daoflow access-assets ssh-key detach --yes` removes the managed key link from a server without deleting the key asset
- `daoflow access-assets ssh-key delete --yes` removes a key and clears server references
- `daoflow access-assets certificate list` reads certificate metadata through `certificateAssets`
- `daoflow access-assets certificate create --yes` stores encrypted certificate/private-key/CA-chain material and returns only safe metadata
- `daoflow access-assets certificate delete --yes` deletes a certificate asset and requires `server:write`
- JSON list success shapes:
  - `{ "ok": true, "data": { "keys": [{ "id": string, "name": string, "teamId": string, "username": string | null, "fingerprint": string, "keyType": string, "hasPrivateKey": boolean, "status": string, "lastUsedAt": string | null, "rotatedAt": string | null, "createdAt": string, "updatedAt": string }] } }`
  - `{ "ok": true, "data": { "certificates": [{ "id": string, "name": string, "teamId": string, "fingerprint": string, "subject": string | null, "issuer": string | null, "expiresAt": string | null, "domains": string[], "hasPrivateKey": boolean, "hasCaChain": boolean, "status": string, "createdAt": string, "updatedAt": string }] } }`
- JSON mutation success shapes:
  - `ssh-key create|rotate`: `{ "ok": true, "data": { "key": { "id": string, "name": string, "fingerprint": string, "hasPrivateKey": true } } }`
  - `ssh-key attach`: `{ "ok": true, "data": { "server": { "id": string, "sshKeyId": string | null }, "key": { "id": string, "name": string } } }`
  - `ssh-key delete`: `{ "ok": true, "data": { "deleted": true, "keyId": string } }`
  - `certificate create`: `{ "ok": true, "data": { "certificate": { "id": string, "name": string, "fingerprint": string, "hasPrivateKey": boolean, "hasCaChain": boolean } } }`
  - `certificate delete`: `{ "ok": true, "data": { "deleted": true, "certificateId": string } }`

## Plan Command Contract

- `daoflow plan` is a planning-lane command backed by the control plane, not a local CLI stub
- One target is required:
  - `--service <id|name>` for registered-service planning through `deploymentPlan`
  - `--compose <path>` for direct compose planning through `composeDeploymentPlan`
- Optional input:
  - Service plan: `--server <id|name>`, `--image <ref>`, `--preview-branch <branch>`, `--preview-pr <number>`, `--preview-close`, `--json`
  - Compose plan: `--context <path>`, `--server <id|name>`, `--json`
- Preview targeting is only valid for service planning and service deploys. The CLI must reject preview flags with direct `--compose` plan or deploy requests using `INVALID_INPUT`.
- For compose plan and direct compose deploy, `--context` must cover every compose-relative local input that needs upload, including `build.context`, bundleable `build.additional_contexts`, file-backed build secrets, and local `env_file` assets. The CLI must fail with `INVALID_INPUT` before any API call when the configured context root is too narrow.
- JSON service success shape:
  - `{ "ok": true, "data": { "isReady": boolean, "service": {...}, "managedTraefikRouting": { "provider": "traefik", "routes": [...] } | null, "composeEnvPlan": { "branch": string, "matchedBranchOverrideCount": number, "composeEnv": { "precedence": string[], "counts": { "total": number, "repoDefaults": number, "environmentVariables": number, "runtime": number, "build": number, "secrets": number, "overriddenRepoDefaults": number }, "warnings": string[], "entries": [{ "key": string, "displayValue": string, "category": "runtime" | "build" | "default", "isSecret": boolean, "source": "inline" | "1password" | "repo-default", "branchPattern": string | null, "origin": "repo-default" | "environment-variable", "overrodeRepoDefault": boolean }] }, "interpolation": { "status": "ok" | "warn" | "fail" | "unavailable", "summary": { "totalReferences": number, "unresolved": number, "requiredMissing": number, "optionalMissing": number }, "warnings": string[], "unresolved": [{ "key": string, "expression": string, "severity": "warn" | "fail", "detail": string }] } } | null, "target": {...}, "currentDeployment": {...} | null, "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } }`
- JSON compose success shape:
  - `{ "ok": true, "data": { "isReady": boolean, "deploymentSource": "uploaded-context" | "uploaded-compose", "project": { "id": string | null, "name": string, "action": "reuse" | "create" }, "environment": { "id": string | null, "name": string, "action": "reuse" | "create" }, "service": { "id": string | null, "name": string, "action": "reuse" | "create", "sourceType": "compose" }, "composeEnvPlan": { "branch": string, "matchedBranchOverrideCount": number, "composeEnv": { "precedence": string[], "counts": { "total": number, "repoDefaults": number, "environmentVariables": number, "runtime": number, "build": number, "secrets": number, "overriddenRepoDefaults": number }, "warnings": string[], "entries": [{ "key": string, "displayValue": string, "category": "runtime" | "build" | "default", "isSecret": boolean, "source": "inline" | "1password" | "repo-default", "branchPattern": string | null, "origin": "repo-default" | "environment-variable", "overrodeRepoDefault": boolean }] }, "interpolation": { "status": "ok" | "warn" | "fail" | "unavailable", "summary": { "totalReferences": number, "unresolved": number, "requiredMissing": number, "optionalMissing": number }, "warnings": string[], "unresolved": [{ "key": string, "expression": string, "severity": "warn" | "fail", "detail": string }] } }, "target": { "serverId": string, "serverName": string, "serverHost": string, "composePath": string | null, "contextPath": string | null, "requiresContextUpload": boolean, "localBuildContexts": [{ "serviceName": string, "context": string, "dockerfile": string | null }], "contextBundle": { "fileCount": number, "sizeBytes": number, "includedOverrides": string[] } | null }, "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } }`
- Human output must show:
  - service or compose scope, project, environment, target server
  - target kind and rollout mode, including explicit Swarm stack wording for `docker-swarm-manager` compose plans
  - target image for service plans
  - local build-context and bundle details for compose plans
  - compose env precedence, redacted provenance, and interpolation diagnostics for compose-backed plans
  - current deployment status when present for service plans
  - ordered planned steps
  - preflight checks with `ok` / `warn` / `fail`

## Deploy Dry-Run Contract

- `daoflow deploy --service <id> --dry-run` must use the planning lane `deploymentPlan` route
- `daoflow deploy --compose <path> --dry-run` must use the planning lane `composeDeploymentPlan` route
- Service dry-run scope: `deploy:read`
- Compose dry-run scope: `deploy:read`
- Service execution scope: `deploy:start`
- Service dry-run and service execution may include preview input through `--preview-branch <branch>`, optional `--preview-pr <number>`, and optional `--preview-close`.
- For direct compose deploys, `--context <path>` must cover every compose-relative local input that will be bundled for upload. The CLI must reject too-narrow roots with `INVALID_INPUT` before confirmation or mutation.
- JSON service dry-run shape:
  - `{ "ok": true, "data": { "dryRun": true, "plan": { "isReady": boolean, "service": {...}, "composeEnvPlan": { "branch": string, "matchedBranchOverrideCount": number, "composeEnv": { "precedence": string[], "counts": { "total": number, "repoDefaults": number, "environmentVariables": number, "runtime": number, "build": number, "secrets": number, "overriddenRepoDefaults": number }, "warnings": string[], "entries": [{ "key": string, "displayValue": string, "category": "runtime" | "build" | "default", "isSecret": boolean, "source": "inline" | "1password" | "repo-default", "branchPattern": string | null, "origin": "repo-default" | "environment-variable", "overrodeRepoDefault": boolean }] }, "interpolation": { "status": "ok" | "warn" | "fail" | "unavailable", "summary": { "totalReferences": number, "unresolved": number, "requiredMissing": number, "optionalMissing": number }, "warnings": string[], "unresolved": [{ "key": string, "expression": string, "severity": "warn" | "fail", "detail": string }] } } | null, "target": { "serverId": string | null, "serverName": string | null, "serverHost": string | null, "targetKind": "docker-engine" | "docker-swarm-manager" | null, "imageTag": string | null, "preview": {...} | null }, "currentDeployment": {...} | null, "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } } }`
- JSON compose dry-run shape:
  - `{ "ok": true, "data": { "dryRun": true, "plan": { "isReady": boolean, "deploymentSource": "uploaded-context" | "uploaded-compose", "project": { "id": string | null, "name": string, "action": "reuse" | "create" }, "environment": { "id": string | null, "name": string, "action": "reuse" | "create" }, "service": { "id": string | null, "name": string, "action": "reuse" | "create", "sourceType": "compose" }, "composeEnvPlan": { "branch": string, "matchedBranchOverrideCount": number, "composeEnv": { "precedence": string[], "counts": { "total": number, "repoDefaults": number, "environmentVariables": number, "runtime": number, "build": number, "secrets": number, "overriddenRepoDefaults": number }, "warnings": string[], "entries": [{ "key": string, "displayValue": string, "category": "runtime" | "build" | "default", "isSecret": boolean, "source": "inline" | "1password" | "repo-default", "branchPattern": string | null, "origin": "repo-default" | "environment-variable", "overrodeRepoDefault": boolean }] }, "interpolation": { "status": "ok" | "warn" | "fail" | "unavailable", "summary": { "totalReferences": number, "unresolved": number, "requiredMissing": number, "optionalMissing": number }, "warnings": string[], "unresolved": [{ "key": string, "expression": string, "severity": "warn" | "fail", "detail": string }] } }, "target": { "serverId": string, "serverName": string, "serverHost": string, "targetKind": "docker-engine" | "docker-swarm-manager", "composePath": string | null, "contextPath": string | null, "requiresContextUpload": boolean, "localBuildContexts": [{ "serviceName": string, "context": string, "dockerfile": string | null }], "contextBundle": { "fileCount": number, "sizeBytes": number, "includedOverrides": string[] } | null }, "preflightChecks": [{ "status": "ok" | "warn" | "fail", "detail": string }], "steps": string[], "executeCommand": string } } }`

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

## Logs Contract

- `daoflow logs` reads persisted deployment log lines through the `deploymentLogs` read procedure
- Scope: `logs:read`
- Optional targeting input:
  - positional `[service]` to filter global recent logs by service name
  - `--deployment <id>` to scope results to one deployment
  - `--service-id <id>` to follow live container logs for a service
  - `--query <text>` to search within persisted log messages
  - `--stream <all|stdout|stderr>` to filter by log stream
  - `--lines <n>` to cap returned lines
- `--follow --deployment <id>` streams persisted deployment logs over SSE
- `--follow --service-id <id>` streams live container logs over WebSocket
- `--follow --json` emits newline-delimited `{ "ok": true, "data": ... }` envelopes, one per log line
- JSON success shape:
  - `{ "ok": true, "data": { "service": string | null, "deploymentId": string | null, "query": string | null, "stream": "all" | "stdout" | "stderr", "limit": number, "summary": { "totalLines": number, "stderrLines": number, "deploymentCount": number }, "lines": [{ "id": string | number, "deploymentId": string, "serviceName": string, "environmentName": string, "stream": "stdout" | "stderr", "lineNumber": string | number, "level": string, "message": string, "createdAt": string }] } }`

## Audit Contract

- `daoflow audit` reads immutable audit records through the `auditTrail` read procedure
- Access: any valid session or API token
- Optional input:
  - `--limit <n>` to cap returned entries from `1` to `50`
  - `--since <window>` to filter entries newer than a positive duration like `15m`, `1h`, `7d`, or `2w`
  - `--json`
- JSON success shape:
  - `{ "ok": true, "data": { "limit": number, "since": string | null, "summary": { "totalEntries": number, "deploymentActions": number, "executionActions": number, "backupActions": number, "humanEntries": number }, "entries": [{ "id": string, "actorType": string, "actorId": string, "actorEmail": string | null, "actorRole": string | null, "organizationId": string | null, "targetResource": string, "action": string, "inputSummary": string | null, "permissionScope": string | null, "outcome": string, "metadata": object | null, "createdAt": string, "actorLabel": string, "resourceType": string, "resourceId": string, "resourceLabel": string, "statusTone": "healthy" | "failed" | "running" | "queued", "detail": string }] } }`
- Summary semantics:
  - `summary` counts must describe the full filtered result set
  - `entries` remains capped by `--limit`
- Human output must show:
  - entry timestamp, action, and outcome tone
  - actor identity and actor type
  - resource label
  - permission scope when present
  - redacted audit detail when present
- Invalid `--since` input must fail locally with `INVALID_INPUT` before any API call

## Access Logs Contract

- `daoflow access-logs` reads durable request/access records through the `accessLogs` read procedure
- Scope: `logs:read`
- Optional input:
  - `--limit <n>` to cap returned entries from `1` to `100`
  - `--cursor <cursor>` to fetch the next page
  - `--since <window>` to filter entries newer than a positive duration like `15m`, `1h`, `7d`, or `2w`
  - `--status <failed-auth|denied|error|slow|webhook|api-token>` for operator triage shortcuts
  - `--method <method>`, `--path <pattern>`, `--actor-type <user|service|agent|token>`, `--token <id>`, `--request-id <id>`, `--search <term>`, and `--min-duration-ms <ms>` for focused investigation
  - `--json`
- JSON success shape:
  - `{ "ok": true, "data": { "limit": number, "cursor": string | null, "nextCursor": string | null, "filters": { "status": string | null, "method": string | null, "path": string | null, "actorType": string | null, "tokenId": string | null, "requestId": string | null, "since": string | null, "search": string | null, "minDurationMs": number | null }, "summary": { "totalEntries": number, "failedAuth": number, "deniedScopes": number, "webhookRequests": number, "apiTokenRequests": number, "slowRequests": number, "errorResponses": number }, "retentionDays": number, "entries": [{ "id": string, "requestId": string, "method": string, "path": string, "category": string, "statusCode": number, "outcome": string, "durationMs": number, "authMethod": string | null, "actorType": string | null, "actorId": string | null, "actorEmail": string | null, "actorRole": string | null, "tokenId": string | null, "tokenName": string | null, "tokenPrefix": string | null, "requiredScopes": string[], "grantedScopes": string[], "sourceIp": string | null, "userAgent": string | null, "errorCategory": string | null, "createdAt": string }] } }`
- Safety rules:
  - never store or print request bodies, response bodies, cookies, authorization headers, raw bearer tokens, or raw query strings
  - token display is limited to id, name, and prefix
  - `summary` counts must describe the full filtered result set, while `entries` remains capped by `--limit`
- Invalid filter input must fail locally with `INVALID_INPUT` before any API call

## Approvals Contract

- `daoflow approvals list` reads the authenticated approval queue through `approvalQueue`
- Access for `approvals list`: any valid session or API token
- Optional input:
  - `--limit <n>` to cap returned entries from `1` to `40`
  - `--json`
- JSON list success shape:
  - `{ "ok": true, "data": { "limit": number, "summary": { "totalRequests": number, "pendingRequests": number, "approvedRequests": number, "rejectedRequests": number, "criticalRequests": number }, "requests": [{ "id": string, "actionType": "compose-release" | "backup-restore", "targetResource": string, "reason": string, "status": string, "requestedByUserId": string, "requestedByEmail": string | null, "requestedByRole": string | null, "resolvedByUserId": string | null, "resolvedByEmail": string | null, "inputSummary": object | null, "createdAt": string, "resolvedAt": string | null, "requestedBy": string, "resourceLabel": string, "riskLevel": "medium" | "elevated" | "critical", "statusTone": "healthy" | "failed" | "running", "commandSummary": string, "requestedAt": string, "expiresAt": string, "decidedBy": string | null, "decidedAt": string | null, "recommendedChecks": string[] }] } }`
- Human output must show:
  - queue totals with pending and critical counts
  - per-request id, action type, resource label, requester, and reason
  - decision metadata when already resolved
  - recommended checks when present
- `daoflow approvals approve --yes` writes through `approveApprovalRequest` and requires `approvals:decide`
- `daoflow approvals reject --yes` writes through `rejectApprovalRequest` and requires `approvals:decide`
- `daoflow approvals approve|reject` must require `--yes` and return `CONFIRMATION_REQUIRED` without any API call when confirmation is missing
- Permission-denied responses for `approveApprovalRequest` and `rejectApprovalRequest` must preserve the exact `SCOPE_DENIED` payload details
- JSON decision success shape:
  - `{ "ok": true, "data": { "request": { "id": string, "actionType": "compose-release" | "backup-restore", "targetResource": string, "resourceLabel": string, "status": string, "statusTone": "healthy" | "failed" | "running", "reason": string, "decidedBy": string | null, "decidedAt": string | null } } }`

## Notifications Contract

- `daoflow notifications list` reads configured notification channels from the control plane
- `daoflow notifications logs` reads recent notification delivery attempts
- Access: any valid session or API token
- JSON list success shape:
  - `{ "ok": true, "data": { "channels": [{ "id": string, "name": string, "channelType": string, "webhookUrl": string | null, "email": string | null, "projectFilter": string | null, "environmentFilter": string | null, "eventSelectors": string[], "enabled": boolean, "createdAt": string, "updatedAt": string }] } }`
- JSON log success shape:
  - `{ "ok": true, "data": { "limit": number, "logs": [{ "id": string, "channelId": string, "channelName": string, "channelType": string, "eventType": string, "payload": unknown, "httpStatus": string | null, "status": string, "error": string | null, "sentAt": string }] } }`

## Status Contract

- `daoflow status` reads the public health endpoint plus the authenticated `serverReadiness` view
- Scope: `server:read`
- JSON success shape:
  - `{ "ok": true, "data": { "context": string, "apiUrl": string, "health": { "status": string, "service": string, "timestamp": string } | null, "servers": { "summary": { "totalServers": number, "readyServers": number, "attentionServers": number, "blockedServers": number, "pollIntervalMs": number, "averageLatencyMs": number | null }, "checks": [{ "serverId": string, "serverName": string, "serverHost": string, "targetKind": string, "swarmTopology": { "clusterId": string, "clusterName": string, "source": "registration" | "manual" | "discovered", "defaultNamespace": string | null, "summary": { "nodeCount": number, "managerCount": number, "workerCount": number, "activeNodeCount": number, "reachableNodeCount": number }, "nodes": [{ "id": string, "name": string, "host": string | null, "role": "manager" | "worker", "availability": "active" | "pause" | "drain" | "unknown", "reachability": "reachable" | "unreachable" | "unknown", "managerStatus": "leader" | "reachable" | "unreachable" | "none" | "unknown" }] } | null, "serverStatus": string, "readinessStatus": string, "statusTone": string, "sshPort": number, "sshReachable": boolean, "dockerReachable": boolean, "composeReachable": boolean, "dockerVersion": string | null, "composeVersion": string | null, "latencyMs": number | null, "checkedAt": string, "issues": string[], "recommendedActions": string[] }] } | null } }`
- Human output must show:
  - total ready vs attention servers
  - configured poll interval and average latency when available
  - per-server readiness state, Docker/Compose versions, last check timestamp, and issues
  - Swarm manager topology summary when `swarmTopology` is present

## Projects Contract

- `daoflow projects list` reads the scoped project inventory
- `daoflow projects show <project-id>` reads one scoped project plus its environments
- `daoflow projects create --dry-run` must return a local preview and exit with code `3`
- `daoflow projects create --yes` writes through `createProject` and requires `deploy:start`
- `daoflow projects create` supports provider-linked repositories with:
  - `--git-provider-id <id>`
  - `--git-installation-id <id>`
  - `--repo-full-name <owner/repo-or-group/project>`
  - `--default-branch <branch>`
  - `--compose-path <path>`
  - `--auto-deploy` and `--auto-deploy-branch <branch>`
- `daoflow projects create` supports generic private repository credentials with:
  - `--repo-credential-kind <https-token|https-basic|ssh-key>`
  - `--repo-credential-username <username>` for HTTPS token username overrides and HTTPS basic auth
  - `--repo-credential-token-env <env>` or `--repo-credential-token-file <path>`
  - `--repo-credential-password-env <env>` or `--repo-credential-password-file <path>`
  - `--repo-credential-ssh-key-env <env>` or `--repo-credential-ssh-key-file <path>`
- Repository credential dry-runs and success responses must never print token, password, or private-key material.
- `daoflow projects delete --dry-run` must return a local preview and exit with code `3`
- `daoflow projects delete --yes` writes through `deleteProject` and requires `service:update`
- `daoflow projects env list --project <id>` reads scoped environments for the project and requires `deploy:read`

## Local Install Contract

- `daoflow install` is a local-lane bootstrap command and never requires API auth
- `daoflow install --json` success shape:
  - `{ "ok": true, "version": string, "directory": string, "domain": string, "port": number, "url": string, "healthy": boolean, "exposure": { "ok": boolean, "mode": "none" | "cloudflare-quick" | "tailscale-serve" | "tailscale-funnel" | "traefik", "access": "local" | "tailnet" | "public", "url": string | null, "detail": string | null, "statePath": string | null, "logPath": string | null }, "cloudflareTunnel"?: { "publicUrl": string, "guide": string[] }, "configFiles": string[] }`
- `daoflow install --expose <mode>` supports:
  - `none` for host-only access
  - `traefik` for a built-in public HTTPS edge with automatic Let's Encrypt
  - `cloudflare-quick` for an ephemeral public `trycloudflare.com` URL when `cloudflared` is installed
  - `tailscale-serve` for a tailnet-only HTTPS URL when `tailscale` is installed and authenticated
  - `tailscale-funnel` for a public HTTPS URL through Tailscale Funnel when `tailscale` is installed and authenticated
- `daoflow install --cloudflare-tunnel --cloudflare-tunnel-token <token>` enables a `cloudflared` sidecar for a named Cloudflare Tunnel and must:
  - require a public domain like `deploy.example.com`
  - keep the DaoFlow container bound to localhost on the host
  - write `CLOUDFLARE_TUNNEL_TOKEN` into `.env`
  - print the origin guide telling the operator to route the tunnel hostname to `http://daoflow:3000`
- When exposure setup returns a concrete HTTPS URL, `daoflow install` must rewrite `BETTER_AUTH_URL` to that URL and re-apply the compose stack so Better Auth uses the externally reachable origin
- `daoflow install` must preserve existing secrets and settings when re-run in an existing install directory unless the operator explicitly overrides managed fields
- `daoflow install` must write a compose file fetched from the matching CLI release tag when the CLI version is a concrete semver release, falling back to the embedded compose template when network retrieval fails

## Local Upgrade Contract

- `daoflow upgrade` is a local-lane command and never requires API auth
- `daoflow upgrade --json` success shape:
  - `{ "ok": true, "previousVersion": string, "newVersion": string, "directory": string, "healthy": boolean }`
- `daoflow upgrade --version <semver>` must fetch the compose file from the matching release tag before pulling images; `latest` continues to use the mainline compose template
- `daoflow projects env create --dry-run` must return a local preview and exit with code `3`

## Templates Contract

- `daoflow templates list` and `daoflow templates show <slug>` are local catalog reads and do not require API access
- `daoflow templates plan <slug>` is a planning-lane command backed by the existing `composeDeploymentPlan` route and requires `deploy:read`
- `daoflow templates apply <slug> --yes` is a command-lane write that queues the existing direct compose deploy workflow and requires `deploy:start`
- `templates list` and `templates show` must surface template maintenance metadata and freshness state so operators can judge starter drift without reading source files
- Template overrides use repeated `--set key=value`
- Unknown template keys must fail fast before any network request
- Secret template fields must stay masked in human and JSON CLI summaries even though the underlying rendered compose uses the provided value
- `templates list` JSON success shape:
  - `{ "ok": true, "data": { "templates": [{ "slug": string, "name": string, "category": string, "summary": string, "tags": string[], "defaultProjectName": string, "serviceCount": number, "fieldCount": number, "maintenance": { "version": string, "sourceName": string, "sourceUrl": string, "reviewedAt": string, "reviewCadenceDays": number, "changeNotes": string[] }, "freshness": { "status": "current" | "review-soon" | "stale", "reviewedAt": string, "reviewDueAt": string, "daysSinceReview": number, "daysUntilReview": number } }] } }`
- `templates show` JSON success shape:
  - `{ "ok": true, "data": { "template": { "slug": string, "name": string, "category": string, "summary": string, "tags": string[], "defaultProjectName": string, "serviceCount": number, "fieldCount": number, "maintenance": { "version": string, "sourceName": string, "sourceUrl": string, "reviewedAt": string, "reviewCadenceDays": number, "changeNotes": string[] }, "freshness": { "status": "current" | "review-soon" | "stale", "reviewedAt": string, "reviewDueAt": string, "daysSinceReview": number, "daysUntilReview": number }, "description": string, "services": [...], "fields": [...], "volumes": [...], "healthChecks": [...] } } }`
- `templates plan` JSON success shape:
  - `{ "ok": true, "data": { "template": { "slug": string, "name": string }, "projectName": string, "inputs": [{ "key": string, "label": string, "kind": "string" | "secret" | "domain" | "port", "value": string, "isSecret": boolean }], "plan": { ...compose plan... } } }`
- `templates apply` JSON success shape:
  - `{ "ok": true, "data": { "template": { "slug": string, "name": string }, "projectName": string, "serverId": string, "deploymentId": string, "inputs": [{ "key": string, "label": string, "kind": "string" | "secret" | "domain" | "port", "value": string, "isSecret": boolean }] } }`

## Managed Databases Contract

- `daoflow databases list` is a read-lane command backed by `managedDatabases` and requires `deploy:read`
- `daoflow databases show --service <id>` is a read-lane command backed by `serviceDetails`, and only succeeds when the service carries managed database metadata
- `daoflow databases create --kind <postgres|mysql|mariadb|mongo|redis> --project <id> --environment <name> --server <id> --yes` is a command-lane write that renders a curated Compose database stack, stores database metadata on the created service, registers the persistent volume, creates a backup policy, queues the normal Compose deployment path, and requires `service:update`
- `daoflow databases start|restart --service <id> --yes` queues the normal Compose `up` path through `setManagedDatabaseState` and requires `service:update`
- `daoflow databases stop --service <id> --yes` queues the Compose `down` path through `setManagedDatabaseState` and requires `service:update`
- `daoflow databases delete --service <id> --yes` deletes the managed database service record through `deleteManagedDatabase` and requires `service:update`
- Database passwords can be supplied by direct value, environment variable, or file; missing env variables fail fast, and dry-runs and success output must never print raw password material
- `databases list` JSON success shape:
  - `{ "ok": true, "data": { "databases": [{ "serviceId": string, "serviceName": string, "projectId": string, "projectName": string, "environmentId": string, "status": string, "targetServerId": string | null, "createdAt": string, "updatedAt": string, "database": { "kind": string, "label": string, "templateSlug": string, "databaseName": string | null, "username": string | null, "port": string, "internalPort": string, "serviceName": string, "volumeName": string, "volumeId": string | null, "backupPolicyId": string | null, "backupType": "database" | "volume", "backupEngine": string | null, "connectionUriMasked": string, "internalConnectionUriMasked": string } }] } }`
- `databases show` JSON success shape:
  - `{ "ok": true, "data": { "service": { ...service read output... }, "database": { ...managed database metadata with masked connection strings... } } }`
- `databases create` JSON success shape:
  - `{ "ok": true, "data": { "service": { ...service mutation output... }, "deployment": { "id": string, "status": string, "targetServerId": string }, "database": { ...managed database metadata with masked connection strings... }, "volume": { ...registered volume... }, "backupPolicy": { ...backup policy... } } }`
- `databases start|restart|stop` JSON success shape:
  - `{ "ok": true, "data": { "action": "start" | "restart" | "stop", "deployment": { "id": string, "status": string } } }`
- `databases delete` JSON success shape:
  - `{ "ok": true, "data": { "deleted": true } }`
- `daoflow projects env create --yes` writes through `createEnvironment` and requires `deploy:start`
- `daoflow projects env update --dry-run` must return a local preview and exit with code `3`
- `daoflow projects env update --yes` writes through `updateEnvironment` and requires `service:update`
- `daoflow projects env delete --dry-run` must return a local preview and exit with code `3`
- `daoflow projects env delete --yes` writes through `deleteEnvironment` and requires `service:update`
- JSON list success shape:
  - `{ "ok": true, "data": { "summary": { "totalProjects": number, "totalEnvironments": number, "totalServices": number }, "projects": [{ "id": string, "name": string, "description": string | null, "repoFullName": string | null, "repoUrl": string | null, "sourceType": string, "status": string, "statusTone": string, "defaultBranch": string | null, "autoDeploy": boolean, "composeFiles": string[], "composeProfiles": string[], "environmentCount": number, "serviceCount": number, "createdAt": string, "updatedAt": string }] } }`
- JSON show success shape:
  - `{ "ok": true, "data": { "project": { ...project summary... }, "environments": [{ "id": string, "projectId": string, "name": string, "status": string, "statusTone": string, "targetServerId": string | null, "composeFiles": string[], "composeProfiles": string[], "serviceCount": number, "createdAt": string, "updatedAt": string }] } }`
- JSON mutation success shapes:
  - `projects create`: `{ "ok": true, "data": { "project": { "id": string, "name": string, "repoFullName": string | null, "repoUrl": string | null, "status": string } } }`
  - `projects delete`: `{ "ok": true, "data": { "deleted": true, "projectId": string } }`
  - `projects env create|update`: `{ "ok": true, "data": { "environment": { "id": string, "projectId": string, "name": string, "status": string } } }`
  - `projects env delete`: `{ "ok": true, "data": { "deleted": true, "environmentId": string } }`

## Doctor Contract

- `daoflow doctor` verifies local CLI context, API connectivity, and persisted server readiness diagnostics
- Scope: `server:read`, `logs:read`
- JSON success shape:
  - `{ "ok": true, "data": { "checks": [{ "name": string, "status": "ok" | "warn" | "fail", "detail": string }], "summary": { "total": number, "ok": number, "warnings": number, "failures": number } } }`
- JSON failure shape:
  - `{ "ok": false, "error": string, "code": "DOCTOR_FAILED", "data": { "checks": [{ "name": string, "status": "ok" | "warn" | "fail", "detail": string }], "summary": { "total": number, "ok": number, "warnings": number, "failures": number } } }`
- Human output must show:
  - configuration and auth state
  - API connectivity result
  - server poll interval summary
  - one diagnostic line per server including SSH reachability, Docker/Compose versions, last check time, latency, and current issues

## Server Add Contract

- `daoflow server add` writes through the `registerServer` command lane and immediately returns readiness verification detail
- Scope: `server:write`
- Required input:
  - `--name <name>`
  - `--host <host>`
- Optional input:
  - `--region <region>`
  - `--ssh-port <port>`
  - `--ssh-user <user>`
  - `--ssh-key <path>` or `--ssh-private-key <pem>`
  - `--kind <docker-engine|docker-swarm-manager>`
  - `--dry-run`
  - `--yes`
  - `--json`
- `--dry-run` must not call the API and must exit with code `3`
- Execution must require `--yes`
- JSON success shape:
  - `{ "ok": true, "data": { "server": { "id": string, "name": string, "host": string, "region": string | null, "sshPort": number, "sshUser": string | null, "kind": string, "status": string, "dockerVersion": string | null, "composeVersion": string | null, "readiness"?: { "readinessStatus": string, "sshReachable": boolean, "dockerReachable": boolean, "composeReachable": boolean, "latencyMs": number | null, "checkedAt": string, "issues": string[], "recommendedActions": string[] } }, "readiness": { "readinessStatus": string, "sshReachable": boolean, "dockerReachable": boolean, "composeReachable": boolean, "latencyMs": number | null, "checkedAt": string | null, "issues": string[], "recommendedActions": string[] } } }`
- `daoflow server proxy` writes through `configureServerManagedTraefikProxy`
- Scope: `server:write`
- Required input:
  - `--server <id>`
- Optional input:
  - `--disable`
  - `--network <name>`
  - `--entrypoint <name>`
  - `--cert-resolver <name>`
  - `--dns-target <host>`
  - `--dry-run`
  - `--yes`
  - `--json`
- JSON success shape:
  - `{ "ok": true, "data": { "server": { "id": string, "name": string, "host": string, "metadata": object } } }`
