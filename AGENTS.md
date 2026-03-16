# DaoFlow AGENTS.md

This file is the operating charter for humans and coding agents working in this repository.

If the README and this file disagree, follow this file.

## 1. Product Thesis

DaoFlow is the best AI-agent-first deployment and DevOps platform based on Docker and Docker Compose.

The vision is **agentic DevOps — from one prompt to production**.

The goal is not to be an AWS wrapper and not to be a Kubernetes clone. The goal is to build the deployment platform that AI agents can operate safely, reliably, and autonomously — while keeping humans fully in control through scoped permissions, audit trails, and approval gates.

DaoFlow is designed from day one so that an AI coding agent can:

- Read infrastructure state, logs, and deployment history
- Generate deployment plans and rollback strategies
- Execute deployments within scoped permissions
- Diagnose failures and recommend fixes
- Never accidentally break production

The product should feel like:

- The first deployment tool that truly works with AI agents, not against them
- Easier than raw Docker and Docker Compose
- More transparent than closed hosted PaaS products
- More agent-safe than any existing self-hosted deployment tool
- The CLI your AI coding assistant reaches for when it needs to deploy

## 2. What We Are Building

DaoFlow should combine the strongest ideas from Coolify, Dokploy, AgentHub, and Autoresearch into one focused system:

- **An agent-first CLI** that AI coding agents can use directly from their tool-calling loop to deploy, inspect, diagnose, and rollback — with structured JSON output, scoped permissions, and dry-run previews
- **An agent-first API** with three lanes (read, planning, command) so agents can observe and plan without accidentally mutating infrastructure
- A Docker and Docker Compose deployment management UI for bare metal and VPS environments
- Strong support for persistent volumes, backups, restore flows, logs, and deployment history
- Multi-user and multi-agent role-based access control with fine-grained capability scoping
- Agentic observability: logs, events, diffs, and deployment context that are easy for agents to read without giving them unsafe write access

## 3. What We Are Not Building

Avoid product sprawl.

Not in MVP:

- Kubernetes support
- General-purpose cloud resource provisioning across every provider
- Serverless runtimes
- Arbitrary shell access for external AI agents
- Broad marketplace complexity before core deployment is reliable
- “Do everything” PaaS abstractions that hide Docker behavior too much

Swarm support is allowed as a later expansion, but MVP must work extremely well on standalone Docker Engine first.

## 4. Research Synthesis

### Coolify

Learn from Coolify's breadth of resource management, API ability separation, deployment logs, terminal gating, team model, backup flows, and server/resource views.

Relevant patterns observed in local research:

- Separate API abilities such as `read`, `write`, and `deploy`
- Dedicated deployment, logs, backup, server, team, and security surfaces
- Terminal access is explicitly guarded and should not be treated as a normal default capability

### Dokploy

Learn from Dokploy's Compose-first deployment model, Docker Swarm awareness, deployment log file handling, remote execution model, monitoring, notifications, and practical support for backups and volume backups.

Relevant patterns observed in local research:

- Compose is a first-class entity, not an afterthought
- Deployment records should include durable log paths and lifecycle timestamps
- Permissions should include both role-level access and fine-grained capability flags
- Persistent mounts and volume backups deserve first-class data models

### AgentHub

Learn from AgentHub's minimal and sharp model for agents:

- Per-agent API keys
- Rate limits
- Immutable activity history
- Coordination primitives
- Small, inspectable control surfaces

The lesson is not “turn DaoFlow into a git collaboration system.” The lesson is that AI agents need constrained primitives, audit trails, and coordination channels instead of broad ambient authority.

### Autoresearch

Learn from Autoresearch's discipline:

- Small scope
- Clear instructions
- Bounded loops
- Comparable outputs
- Agent workflows designed around controlled iteration

The lesson is to design DaoFlow's agent features so that agents operate inside explicit tasks, plans, and budgets instead of unconstrained automation.

## 5. Product Principles

Every contributor should optimize for these principles:

- Agent-first, human-supervised — every feature must work for both AI agents and humans
- Safety before autonomy — agents default to read-only until explicitly granted write scopes
- Compose-first before platform sprawl
- Transparent infrastructure before magic
- Auditability before convenience — every mutation produces an immutable audit record
- Read-heavy agent access before write-heavy agent access
- Structured output before pretty output — JSON to stdout, prose to stderr
- Opinionated defaults before configuration explosion

## 6. MVP Scope

The MVP must support:

- Organizations or workspaces
- Projects
- Environments
- Servers connected over SSH
- Standalone Docker Engine targets
- Docker Compose deployments
- Image-based and Dockerfile-based application deployments
- Named persistent volumes
- Deployment history and rollback targets
- Real-time and historical logs
- S3-compatible backup storage for database dumps and volume archives
- RBAC for humans
- Service accounts and agent accounts
- Safe API tokens with explicit scopes

The MVP should not require Docker Swarm.

## 7. Recommended Architecture

The architecture must be split into a control plane and an execution plane.

### Control plane

Responsible for:

- UI
- API
- authn and authz
- project metadata
- deployment records
- event timeline
- backup catalog
- audit log
- policy evaluation

Suggested implementation:

- Bun as runtime and package manager
- Vite plus React for the web UI
- tRPC for type-safe API layer
- Drizzle ORM with typed schemas and migrations
- Postgres 17 plus pgvector for primary state and future embedding features
- Redis for background job queue and real-time SSE streaming

### Execution plane

Responsible for:

- running Docker and Docker Compose commands
- streaming logs
- health checks
- collecting deployment output
- performing backups and restores
- executing safe operational actions

Critical rule:

Do not run Docker orchestration directly inside the frontend web process. Long-running deploys, log streams, backup tasks, and restore tasks must run in workers or an agent/runner service.

### Connectivity model

Preferred model:

- DaoFlow control plane connects to managed servers over SSH
- A lightweight optional runner may be installed later for better streaming and lower latency

MVP should start with SSH plus Docker/Compose commands because it is simpler and easier to adopt.

## 8. Core Domain Model

Use a simple domain model first.

- `organization`
- `member`
- `principal`
- `api_token`
- `server`
- `project`
- `environment`
- `service`
- `deployment`
- `deployment_step`
- `volume`
- `backup_policy`
- `backup_run`
- `event`
- `audit_entry`

Notes:

- `principal` includes human users, service accounts, and agent accounts
- `service` is the runtime unit; it may come from image, Dockerfile, or Compose
- `deployment_step` exists because raw log blobs are not enough for reliable UX or agent use
- `event` is a normalized operational timeline, separate from raw logs

## 9. Deployment Model

Support only these deployment sources first:

- Docker image reference
- Git repository plus Dockerfile
- Raw or repository-based `compose.yaml`

Rules:

- Compose is a first-class deployment path
- We should preserve the original Compose file and the rendered runtime spec
- Every deployment must have an immutable record of input, resolved config, actor, target server, timestamps, and outcome
- Rollback must target a known previous deployment record, not “best effort”

## 10. Logs And Agentic Observability

This is a major differentiator. Basic log streaming is not enough.

DaoFlow should expose three observability layers:

- Raw logs: exact stdout and stderr
- Structured deployment timeline: clone, build, pull, create volume, start container, health check, rollback
- Agent-ready summaries: concise, structured explanations of failures, suspected root cause, and suggested safe next actions

Rules:

- Raw logs are append-only and downloadable
- Structured events are normalized and queryable
- Summaries are derived artifacts and must never replace the underlying evidence
- Any AI-generated diagnosis must link back to exact log lines or event IDs

Agentic features we want:

- “Why did this deploy fail?”
- “Compare this deploy to the last successful deploy.”
- “Show config drift between desired and actual state.”
- “Propose a rollback plan without executing it.”

## 11. Permission Model

This is one of the most important parts of the product.

Do not collapse permissions into a single admin/member split.

We need:

- role-based membership for humans
- scoped tokens for integrations
- dedicated agent principals with stricter defaults

Suggested base roles:

- `owner`
- `admin`
- `operator`
- `developer`
- `viewer`
- `agent`

Suggested base capabilities organized by domain:

### Infrastructure

- `server:read` — list servers, view connectivity status
- `server:write` — register, update, or remove servers

### Deployment

- `deploy:read` — view deployment history, steps, and status
- `deploy:start` — queue a new deployment
- `deploy:cancel` — cancel an in-progress deployment
- `deploy:rollback` — roll back to a previous deployment
- `service:read` — list services, view service config
- `service:update` — update service configuration

### Data and Secrets

- `env:read` — list environment variable keys and metadata (values masked)
- `env:write` — create, update, or delete environment variables
- `secrets:read` — read unmasked secret values (highly restricted)
- `secrets:write` — create or rotate secrets
- `volumes:read` — list persistent volumes and mount status
- `volumes:write` — register or remove volumes
- `backup:read` — view backup policies and run history
- `backup:run` — trigger a backup
- `backup:restore` — restore from a backup artifact

### Observability

- `logs:read` — stream and search deployment and container logs
- `events:read` — view structured event timeline
- `diagnostics:read` — view agent-generated failure analysis

### Administration

- `members:manage` — invite, remove, and change roles
- `tokens:manage` — create and revoke API tokens
- `approvals:create` — request approval for a gated action
- `approvals:decide` — approve or reject pending approval requests
- `terminal:open` — open an interactive terminal session (exceptional)
- `policy:override` — override policy-enforced guardrails

Rules:

- External AI agents must default to read-only
- Destructive actions must require explicit elevated scopes
- Terminal access must be exceptional and heavily audited
- Secret reads should be minimized and masked by default
- Agents should receive references, metadata, and redacted values unless a task explicitly requires more
- Agents must not be able to elevate their own permissions
- All write operations via CLI must require `--yes` flag or interactive confirmation
- When a permission is denied, the response must include the exact scope required

## 12. Agent-Safe API Design

This product must be safe for external AI systems.

The API should be split into:

- read APIs
- planning APIs
- command APIs

### Read APIs

Safe by default.

Examples:

- list services
- fetch deployment history
- fetch event timeline
- search logs
- inspect backup status
- compare configs

### Planning APIs

Return intent without execution.

Examples:

- generate deployment plan
- generate rollback plan
- generate backup restore plan
- explain required permissions
- preview config diff

### Command APIs

Actually mutate infrastructure.

Examples:

- start deployment
- cancel deployment
- apply config update
- trigger backup
- restore backup

Rules:

- Command APIs must accept idempotency keys
- Dangerous commands should support dry-run
- Every command must produce an audit record
- High-risk actions should support approval gates
- Agents must never need unrestricted shell access to be useful

### CLI-Specific Guardrails

- Every CLI command must support `--json` for structured machine-readable output
- Every mutating command must support `--dry-run` that outputs a structured preview
- Every destructive command must require `--yes` or prompt for interactive confirmation
- Agent tokens must be validated per-command, not per-session
- CLI must print the exact scope required when a permission is denied
- CLI exit codes must be deterministic: 0 = success, 1 = error, 2 = permission denied, 3 = dry-run completed

## 13. Backups And Persistent Data

Persistent data is a core feature, not a plugin.

MVP requirements:

- named volume registration
- backup policies
- backup execution records
- retention rules
- restore workflows
- S3-compatible remote storage

Backup types:

- database logical dump
- volume archive snapshot
- Compose service backup package where appropriate

Rules:

- Backup metadata must be stored separately from backup blobs
- Restore must target a specific backup artifact and produce its own operation record
- Backups must be visible in UI and API
- Failed backups must be first-class failures, not hidden cron details

## 14. Security And Audit

Every write path must be auditable.

Audit records should include:

- actor type
- actor id
- organization
- target resource
- action
- input summary
- permission scope used
- timestamp
- outcome

Security rules:

- No secrets in plain logs
- No shell command echoing with raw credentials
- No silent privilege escalation
- No hidden background mutation without event emission

## 15. UX Direction

The UX should prioritize clarity over dashboards that look busy.

Primary surfaces:

- deployment timeline
- current service state
- logs with structured annotations
- volume and backup health
- permissions and token scopes
- proposed actions and approval state for agents

Good UX for DaoFlow should answer:

- What is running?
- What changed?
- What failed?
- What data is persistent?
- Who can act on this?
- What is safe to automate?

## 16. Suggested Build Order

Build in this order unless there is a strong reason to change it:

1. Core schema and auth model
2. Server registration and SSH connectivity checks
3. Standalone Docker service deployment
4. Docker Compose deployment
5. Deployment records, steps, and raw logs
6. RBAC and scoped API tokens
7. Named volumes and backup policy model
8. Backup execution and restore flow
9. Agent-safe read and planning APIs
10. Agentic diagnosis and log summarization
11. Notifications and webhooks
12. Swarm support if the standalone model is solid

## 17. Decision Rules For Contributors

When making product or architecture choices:

- Prefer smaller trusted primitives over large magical abstractions
- Prefer durable records over ephemeral process state
- Prefer explicit permissions over convenience shortcuts
- Prefer structured events over parsing raw log strings later
- Prefer one excellent deployment path over many weak ones

If a feature increases system complexity, it must clearly improve at least one of:

- deployment reliability
- operator clarity
- backup safety
- agent safety
- auditability

If it does not, defer it.

## 18. Immediate Next Work

Contributors starting from this repository should focus on:

1. Converting this charter into a concrete architecture document and initial schema
2. Designing the principal, token, role, and scope model first
3. Designing deployment records with both raw logs and structured steps
4. Defining the execution worker boundary before writing deployment code
5. Keeping MVP constrained to Docker Engine plus Compose

## 19. Final Rule

DaoFlow should be opinionated, transparent, and safe.

The winning version of this product is not the one with the most features. It is the one a small team can trust to run production workloads on their own servers, while also letting external AI systems observe, explain, and assist without being able to casually break everything.

## 20. Agent-First CLI Design

The CLI is the primary interface for AI agents. It must be designed for non-human operators from the start.

### Output Contract

- `--json` flag on every command: structured JSON to stdout, progress/errors to stderr
- Without `--json`: human-readable tables and prose to stdout
- JSON output must use flat keys, consistent field names, and ISO 8601 timestamps
- Every JSON response must include `{ "ok": true/false }` at the top level
- Error responses must include `{ "ok": false, "error": "message", "code": "SCOPE_DENIED", "requiredScope": "deploy:start" }`

### Self-Documenting Commands

- `--help` on every command must show:
  - required parameters
  - optional flags
  - required permission scope
  - example usage
  - example JSON output shape
- `daoflow capabilities` must list all available scopes for the current token
- `daoflow whoami` must show current principal, role, and granted scopes

### Composability

- `--quiet` / `-q` flag for bare value output (just the deployment ID, just the URL)
- Support stdin for batch operations where appropriate
- Commands must be idempotent where possible
- All write commands must accept `--idempotency-key` to prevent duplicate operations

### Adversarial Input Safety

- Validate all agent-provided values before sending to the API
- Reject values containing shell metacharacters, path traversals, or control characters
- Truncate excessively long inputs with a clear error message
- Never interpolate user input into shell commands

### Permission Enforcement

- Every command checks scopes before making API calls
- Permission denied errors must be structured and specific: tell the agent exactly which scope it needs
- The CLI must never cache elevated permissions beyond a single command invocation
- `--dry-run` must work even with read-only tokens (shows what would happen, not the actual result)

### Command Scope Map

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

## 21. E2E Implementation Roadmap

Detailed tasks grouped by milestone. Each task should be independently testable end-to-end.

### Milestone 1: Auth and Identity Foundation

1. First user sign-up gets `owner` role — verify via API and UI
2. Second user sign-up gets `viewer` role — verify restricted access
3. Owner can create API tokens with specific scopes — verify token works
4. Owner can create agent principal with read-only scopes
5. Agent token with `deploy:read` can list deployments but cannot start one
6. Token with expired TTL is rejected with structured error
7. `daoflow login` stores token in `~/.daoflow/config.json`
8. `daoflow whoami --json` returns principal, role, and scopes
9. `daoflow capabilities --json` lists all granted scopes

### Milestone 2: Server Management

10. Register a server via UI — verify SSH connectivity check runs
11. Register a server via CLI — `daoflow server add --name vps1 --host 1.2.3.4`
12. `daoflow status --json` returns server health and Docker version
13. `daoflow doctor --json` runs full connectivity and Docker diagnostics
14. Server with failed SSH shows structured error in both UI and CLI
15. Agent token with `server:read` can view but not modify servers

### Milestone 3: Docker Compose Deployment

16. Deploy from compose file via UI — verify deployment record created
17. `daoflow deploy --compose ./compose.yaml --server vps1 --dry-run` shows plan
18. `daoflow deploy --compose ./compose.yaml --server vps1 --yes` executes deployment
19. Deployment record includes: input, resolved config, actor, timestamps, outcome
20. `daoflow logs --deployment <id> --json` streams structured deployment logs
21. Failed deployment produces structured error with root cause and suggestion
22. `daoflow plan --compose ./compose.yaml --server vps1 --json` generates deployment plan without executing

### Milestone 4: Deployment Lifecycle

23. `daoflow services --json` lists all running services with status
24. `daoflow rollback --deployment <id> --dry-run` shows rollback plan
25. `daoflow rollback --deployment <id> --yes` executes rollback
26. Rollback creates its own deployment record with link to original
27. Deployment history is queryable: `daoflow deployments list --limit 10 --json`
28. Deploy with health check — verify health check outcome in deployment record
29. Deploy with failure — verify structured failure analysis available

### Milestone 5: Environment Variables and Secrets

30. `daoflow env list --project myapp --json` shows keys with masked values
31. `daoflow env set KEY=value --project myapp --yes` creates env var
32. `daoflow env set SECRET=val --project myapp --secret --yes` creates masked secret
33. Agent with `env:read` sees keys and metadata but not secret values
34. Agent with `env:write` can create/update but not delete without explicit scope
35. Env var changes trigger audit record with before/after diff (values redacted)

### Milestone 6: Backup and Restore

36. Create backup policy for a volume via UI
37. `daoflow backup list --json` shows policies and run history
38. `daoflow backup run --policy <id> --yes` triggers backup
39. Backup run record includes: start time, duration, size, storage location, outcome
40. `daoflow backup restore --run <id> --dry-run` shows restore plan
41. `daoflow backup restore --run <id> --yes` requires approval gate
42. Backup restore creates audit record and approval request
43. Failed backup produces structured error with next steps

### Milestone 7: Agentic Observability

44. `daoflow logs --service myapp --tail 100 --json` streams structured logs
45. `daoflow events --since 1h --json` returns normalized event timeline
46. `daoflow diagnose --deployment <id> --json` produces agent-ready failure summary
47. Diagnosis links to exact log lines and event IDs
48. `daoflow diff --deployment <id1> --deployment <id2> --json` compares two deployments
49. `daoflow drift --service myapp --json` shows config drift between desired and actual state

### Milestone 8: Approval Gates and Audit

50. High-risk operations (restore, rollback, env secret write) require approval
51. `daoflow approvals list --json` shows pending approval requests
52. `daoflow approvals approve <id> --yes` approves a request (requires `approvals:decide`)
53. All mutations produce immutable audit records visible in UI and API
54. `daoflow audit --since 1h --json` returns audit trail
55. Audit records include: actor, action, resource, scope used, timestamp, outcome
56. Agent cannot approve its own approval requests

### Milestone 9: UI Feature Parity

57. Dashboard shows real-time stats (servers, projects, deployments) from API
58. Projects page shows project cards with services and status badges
59. Servers page shows connectivity status and Docker version
60. Deployments page shows full history with status, actor, and duration
61. Backups page shows policies, runs, and restore status
62. Settings page has functional tabs: General, Users, Tokens, Security, Notifications, Volumes
63. Login page with session management and redirect flow
64. Sidebar navigation works for all pages

### Milestone 10: CI/CD and Quality

65. E2E tests cover auth flow (sign-up, sign-in, sign-out, redirect)
66. E2E tests cover page navigation (all sidebar links)
67. E2E tests cover server management (register, view, connectivity)
68. E2E tests cover deployment lifecycle (create, dispatch, health check, rollback)
69. E2E tests cover backup workflows (create policy, run, restore)
70. E2E tests cover env var management (list, set, mask secrets)
71. E2E tests cover approval workflows (request, approve, reject)
72. E2E tests cover CLI commands (login, status, deploy, logs, env, backup)
73. CI pipeline runs typecheck, lint, format, and E2E on every push
74. CLI binary builds for Linux, macOS, and Windows via `bun build`
