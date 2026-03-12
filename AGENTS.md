# DaoFlow AGENTS.md

This file is the operating charter for humans and coding agents working in this repository.

If the README and this file disagree, follow this file.

## 1. Product Thesis

DaoFlow is an open-source deployment control plane for bare metal servers and VPSs.

The goal is not to be an AWS wrapper and not to be a Kubernetes clone. The goal is to give small teams a fast, opinionated, self-hostable way to deploy and operate applications on Docker-based infrastructure with strong safety for both humans and AI agents.

The product should feel like:

- Easier than raw Docker and Docker Compose
- More transparent than closed hosted PaaS products
- More agent-safe than existing self-hosted deployment tools

## 2. What We Are Building

DaoFlow should combine the strongest ideas from Coolify, Dokploy, AgentHub, and Autoresearch into one focused system:

- A Docker and Docker Compose deployment management UI for bare metal and VPS environments
- Strong support for persistent volumes, backups, restore flows, logs, and deployment history
- Multi-user and multi-agent role-based access control
- An API designed for safe external automation, especially AI agents
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

- Safety before autonomy
- Compose-first before platform sprawl
- Transparent infrastructure before magic
- Auditability before convenience
- Read-heavy agent access before write-heavy agent access
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

- TypeScript end to end
- Next.js for the web UI
- API routes only for lightweight control-plane requests
- Postgres for primary state
- Redis or a queue system for background jobs

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

Suggested base capabilities:

- `read`
- `logs:read`
- `deploy:start`
- `deploy:cancel`
- `service:update`
- `secrets:read`
- `secrets:write`
- `backup:read`
- `backup:run`
- `backup:restore`
- `server:read`
- `server:write`
- `terminal:open`
- `policy:override`

Rules:

- External AI agents must default to read-only
- Destructive actions must require explicit elevated scopes
- Terminal access must be exceptional and heavily audited
- Secret reads should be minimized and masked by default
- Agents should receive references, metadata, and redacted values unless a task explicitly requires more

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
