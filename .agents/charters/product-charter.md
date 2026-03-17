# DaoFlow Product Charter

This file contains the detailed product, architecture, and decision charter for DaoFlow.

## 1. Product Thesis

DaoFlow is the best AI-agent-first hosting platform for deterministic systems based on Docker and Docker Compose.

The vision is **the agentic platform to host deterministic systems — from one prompt to production**.

The tagline is **Open-source Agentic DevOps System — from prompts to production**.

The goal is not to be an AWS wrapper and not to be a Kubernetes clone. The goal is to build the hosting platform that AI agents can operate safely, reliably, and autonomously, while keeping humans fully in control through scoped permissions, audit trails, and approval gates.

DaoFlow is designed from day one so that an AI coding agent can:

- Read infrastructure state, logs, and deployment history
- Generate deployment plans and rollback strategies
- Execute deployments within scoped permissions
- Diagnose failures and recommend fixes
- Never accidentally break production

The product should feel like:

- The first hosting platform that truly works with AI agents, not against them
- Easier than raw Docker and Docker Compose
- More transparent than closed hosted PaaS products
- More agent-safe than any existing self-hosted hosting platform
- The CLI your AI coding assistant reaches for when it needs to deploy

## 2. What We Are Building

DaoFlow should combine the strongest ideas from Coolify, Dokploy, AgentHub, and Autoresearch into one focused system:

- **An agent-first CLI** that AI coding agents can use directly from their tool-calling loop to deploy, inspect, diagnose, and rollback, with structured JSON output, scoped permissions, and dry-run previews
- **An agent-first API** with three lanes (`read`, `planning`, `command`) so agents can observe and plan without accidentally mutating infrastructure
- A Docker and Docker Compose hosting management UI for bare metal and VPS environments
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

- Agent-first, human-supervised
- Safety before autonomy
- Compose-first before platform sprawl
- Transparent infrastructure before magic
- Auditability before convenience
- Read-heavy agent access before write-heavy agent access
- Structured output before pretty output
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

### Control Plane

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

### Execution Plane

Responsible for:

- Running Docker and Docker Compose commands
- Streaming logs
- Health checks
- Collecting deployment output
- Performing backups and restores
- Executing safe operational actions

Critical rule:

Do not run Docker orchestration directly inside the frontend web process. Long-running deploys, log streams, backup tasks, and restore tasks must run in workers or an agent/runner service.

### Connectivity Model

Preferred model:

- DaoFlow control plane connects to managed servers over SSH
- A lightweight optional runner may be installed later for better streaming and lower latency

MVP should start with SSH plus Docker/Compose commands because it is simpler and easier to adopt.

## 8. Core Domain Model

Use a simple domain model first:

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
- Preserve the original Compose file and the rendered runtime spec
- Every deployment must have an immutable record of input, resolved config, actor, target server, timestamps, and outcome
- Rollback must target a known previous deployment record, not “best effort”

## 10. Logs And Agentic Observability

DaoFlow should expose three observability layers:

- Raw logs: exact stdout and stderr
- Structured deployment timeline: clone, build, pull, create volume, start container, health check, rollback
- Agent-ready summaries: concise, structured explanations of failures, suspected root cause, and suggested safe next actions

Rules:

- Raw logs are append-only and downloadable
- Structured events are normalized and queryable
- Summaries are derived artifacts and must never replace the underlying evidence
- Any AI-generated diagnosis must link back to exact log lines or event IDs

Target agentic capabilities:

- Explain why a deploy failed
- Compare a failed deploy to the last successful deploy
- Show config drift between desired and actual state
- Propose a rollback plan without executing it

## 11. Permission Model

Do not collapse permissions into a single admin/member split.

We need:

- Role-based membership for humans
- Scoped tokens for integrations
- Dedicated agent principals with stricter defaults

Suggested base roles:

- `owner`
- `admin`
- `operator`
- `developer`
- `viewer`
- `agent`

Base capabilities are documented in [cli-contract.md](/Volumes/QuickMac/DaoFlow-clone-3/.agents/references/cli-contract.md).

Rules:

- External AI agents must default to read-only
- Destructive actions must require explicit elevated scopes
- Terminal access must be exceptional and heavily audited
- Secret reads should be minimized and masked by default
- Agents must not be able to elevate their own permissions
- All write operations via CLI must require `--yes` or interactive confirmation
- Permission denied responses must include the exact required scope

## 12. Agent-Safe API Design

The API should be split into:

- `read`
- `planning`
- `command`

Rules:

- Command APIs must accept idempotency keys
- Dangerous commands should support dry-run
- Every command must produce an audit record
- High-risk actions should support approval gates
- Agents must never need unrestricted shell access to be useful

## 13. Backups And Persistent Data

Persistent data is a core feature, not a plugin.

MVP requirements:

- Named volume registration
- Backup policies
- Backup execution records
- Retention rules
- Restore workflows
- S3-compatible remote storage

Rules:

- Backup metadata must be stored separately from backup blobs
- Restore must target a specific backup artifact and produce its own operation record
- Backups must be visible in UI and API
- Failed backups must be first-class failures

## 14. Security And Audit

Every write path must be auditable.

Audit records should include:

- Actor type
- Actor id
- Organization
- Target resource
- Action
- Input summary
- Permission scope used
- Timestamp
- Outcome

Security rules:

- No secrets in plain logs
- No shell command echoing with raw credentials
- No silent privilege escalation
- No hidden background mutation without event emission

## 15. UX Direction

The UX should prioritize clarity over busy dashboards.

Primary surfaces:

- Deployment timeline
- Current service state
- Logs with structured annotations
- Volume and backup health
- Permissions and token scopes
- Proposed actions and approval state for agents

Every UX surface should answer:

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

## 17. Decision Rules

When making product or architecture choices:

- Prefer smaller trusted primitives over large magical abstractions
- Prefer durable records over ephemeral process state
- Prefer explicit permissions over convenience shortcuts
- Prefer structured events over parsing raw log strings later
- Prefer one excellent deployment path over many weak ones

If a feature increases system complexity, it must clearly improve at least one of:

- Deployment reliability
- Operator clarity
- Backup safety
- Agent safety
- Auditability

If it does not, defer it.

## 18. Implementation Hygiene

Keep hand-written modules small and composable.

- Extract helpers, view-model mappers, and service modules before a file becomes hard to scan
- Split hand-written files before they grow past roughly 300 lines
- Do not introduce new hand-written files above 500 lines unless the user explicitly asks for it or the file is generated
- Split files that mix unrelated concerns such as routing, persistence, formatting, and policy logic

## 19. Immediate Next Work

Contributors starting from this repository should focus on:

1. Converting this charter into a concrete architecture document and initial schema
2. Designing the principal, token, role, and scope model first
3. Designing deployment records with both raw logs and structured steps
4. Defining the execution worker boundary before writing deployment code
5. Keeping MVP constrained to Docker Engine plus Compose

## 20. Final Rule

DaoFlow should be opinionated, transparent, and safe.

The winning version of this product is not the one with the most features. It is the one a small team can trust to run production workloads on their own servers, while also letting external AI systems observe, explain, and assist without being able to casually break everything.
