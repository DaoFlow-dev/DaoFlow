---
sidebar_position: 6
---

# Vision & Principles

DaoFlow exists to make production deployment on your own servers dependable enough for a small team to operate without a dedicated platform team.

The primary product is a deployment platform: connect GitHub or GitLab, configure an application in the Web UI, deploy it to a Docker server, understand what happened, and recover safely when something fails. The CLI exposes the same deployment engine for humans, CI, and constrained automation.

## Why DaoFlow?

Self-hosting should not require operators to assemble unrelated scripts for source control, builds, releases, logs, backups, and recovery. Existing platforms prove that a useful control plane can make these workflows approachable. DaoFlow builds on that lesson while making production safety and evidence part of the deployment model.

Teams should not have to choose between:

- **Vendor lock-in** — an easy deployment experience that only works on someone else's cloud
- **Unsafe flexibility** — raw Docker and SSH access without durable plans, permissions, or recovery evidence
- **Shallow automation** — APIs and CLIs that can start work but cannot reliably explain, constrain, or recover it

DaoFlow's goal is a strong middle path: **a practical Coolify- or Dokploy-class deployment experience, with stricter permissions, immutable operation history, explicit approval for dangerous actions, and deterministic CLI contracts**.

## Product Priority

Work is prioritized in this order:

1. **Production deployment reliability** — remote Docker/Compose execution, health checks, rollback, cleanup, resource limits, and recovery
2. **Web UI and source-control integration** — GitHub and GitLab installation, repository and branch selection, push and pull-request builds, deployment status, logs, and approvals
3. **Production data safety** — team-scoped registries, backup destinations, backup and restore verification, and credential isolation
4. **CLI parity** — every important deployment and recovery workflow available with stable structured output, dry-run, permissions, and audit evidence
5. **Agentic access** — agents may use the CLI/API under the same constraints, but agent-specific breadth does not outrank deployment readiness

Features outside this path are deferred when they compete with making the core deployment loop trustworthy.

## Open-Source Principles

DaoFlow is inspired by the same open-source ethos that drives projects like OpenClaw: the belief that the most impactful tools should be transparent, community-owned, and designed for maximum impact — not maximum revenue.

### Security as Architecture

Security is not a feature we bolt on. It's an architectural decision made at the foundation:

- Automation principals default to **read-only** — zero write access until explicitly granted
- Every write operation produces an **immutable audit record**
- Secrets are **masked by default** — callers cannot read credentials unless specifically authorized
- **Approval gates** ensure humans stay in the loop for dangerous operations

Security-sensitive deployment paths fail closed when required trust, scope, or approval evidence is missing.

### Data Ownership

Your data runs on your servers. Period.

- No telemetry sent to third parties
- No vendor cloud dependency
- Standard Docker Compose — move servers anytime with zero lock-in
- Your backups, your volumes, your jurisdiction

You own every bit of deployment state, and nothing leaves your infrastructure without your explicit action.

### Transparency Through Open Source

DaoFlow is fully open source under the MIT license. Every line of code is inspectable. Every design decision is documented in [AGENTS.md](https://github.com/DaoFlow-dev/DaoFlow/blob/main/AGENTS.md).

We believe transparency creates trust. When software has access to production infrastructure, operators need to know exactly what the platform can and cannot do. Open source makes that possible.

### Impact Over Enterprise

DaoFlow is built to be the tool a small team can trust to run production workloads on their own servers. Automation may observe, explain, and assist, but it must not be able to casually break production.

The goal is impact: make reliable self-hosted deployments accessible to everyone, not just teams with dedicated DevOps engineers.

### Deterministic by Design

Unlike chatbots that generate different responses each time, DaoFlow is deterministic:

- `daoflow deploy --compose ./compose.yaml --yes` produces the same result every time
- Deployment records capture exact inputs, resolved configs, and outcomes
- Rollback targets a specific previous deployment — not "best effort"
- Exit codes are consistent: `0` = success, `1` = error, `2` = denied, `3` = dry-run

Humans, CI systems, and agents all need deterministic tools. DaoFlow exposes one deployment contract to all three.

## One Deployment Engine, Multiple Interfaces

DaoFlow is designed around these outcomes:

1. **The Web UI is a complete production operator surface** — not a thin wrapper around missing server behavior
2. **GitHub and GitLab are first-class deployment sources** — commit, branch, pull-request or merge-request, and build status remain traceable
3. **The CLI has deployment parity** — it uses the same plans, permissions, approvals, and records as the Web UI
4. **Automation is constrained by default** — scoped permissions beat ambient shell access
5. **Self-hosting remains portable and open** — standard Docker and Compose workloads stay under the operator's control

An agent is one possible CLI/API caller. It is not a separate deployment system and does not receive a shortcut around production controls.

## Decision Rules

When we make product or architecture choices, we optimize for these principles:

- Prefer **smaller trusted primitives** over large magical abstractions
- Prefer **durable records** over ephemeral process state
- Prefer **explicit permissions** over convenience shortcuts
- Prefer **structured events** over parsing raw log strings later
- Prefer **one excellent deployment path** over many weak ones
- Prefer **agent safety** over agent convenience

If a feature increases system complexity, it must clearly improve at least one of: deployment reliability, operator clarity, backup safety, agent safety, or auditability. If it does not, we defer it.
