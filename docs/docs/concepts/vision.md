---
sidebar_position: 6
---

# Vision & Principles

<!-- readiness-claim: id=production-deployment-readiness state=goal -->

**Goal:** DaoFlow aims to make self-hosted Docker Compose deployments dependable enough for a small team to operate without a dedicated platform team.
<!-- /readiness-claim -->

The intended product is a deployment platform: connect GitHub or GitLab, configure an application in the Web UI, deploy it to a Docker server, understand what happened, and recover with clear evidence when something fails. The CLI is intended to expose the same deployment engine for humans, CI, and constrained automation.

## Why DaoFlow?

Self-hosting should not require operators to assemble unrelated scripts for source control, builds, releases, logs, backups, and recovery. Existing platforms prove that a useful control plane can make these workflows approachable. DaoFlow builds on that lesson while making production safety and evidence part of the deployment model.

Teams should not have to choose between:

- **Vendor lock-in** — an easy deployment experience that only works on someone else's cloud
- **Unsafe flexibility** — raw Docker and SSH access without durable plans, permissions, or recovery evidence
- **Shallow automation** — APIs and CLIs that can start work but cannot consistently explain, constrain, or recover it

DaoFlow's goal is a strong middle path: **a practical Coolify- or Dokploy-class deployment experience, with stricter permissions, evidence-backed operation history, explicit approval for dangerous actions, and stable CLI contracts**.

## Product Priority

Work is prioritized in this order:

1. **Production deployment reliability** — remote Docker/Compose execution, health checks, rollback, cleanup, resource limits, and recovery
2. **Web UI and source-control integration** — GitHub and GitLab installation, repository and branch selection, push and pull-request builds, deployment status, logs, and approvals
3. **Production data safety** — team-scoped registries, backup destinations, backup and restore verification, and credential isolation
4. **CLI parity** — important deployment and recovery workflows available with stable structured output, dry-run, permissions, and audit evidence
5. **Agentic access** — agents may use the CLI/API under the same constraints, but agent-specific breadth does not outrank deployment readiness

Features outside this path are deferred when they compete with making the core deployment loop trustworthy.

## Open-Source Principles

DaoFlow is inspired by the same open-source ethos that drives projects like OpenClaw: the belief that the most impactful tools should be transparent, community-owned, and designed for maximum impact — not maximum revenue.

### Security as Architecture

Security is an architectural priority. The following controls are targets, not an assertion that end-to-end production assurance has already been achieved:

- Automation principals should default to **read-only** until explicitly granted a scoped write capability
- Write paths should produce durable audit evidence
- Secrets should be masked unless specifically authorized
- **Approval gates** should keep humans in the loop for dangerous operations

<!-- readiness-claim: id=agent-safety-controls state=limitation -->

**Current limitation:** Agent permissions and destructive-action controls are under active verification and are not yet an unconditional production-safety guarantee.
<!-- /readiness-claim -->

<!-- readiness-claim: id=command-audit-completeness state=limitation -->

**Current limitation:** DaoFlow has not yet proved that every command-lane mutation creates a complete immutable audit record.
<!-- /readiness-claim -->

<!-- readiness-claim: id=backup-restore-assurance state=limitation -->

**Current limitation:** Backup and restore workflows have not yet been proven through a current real-infrastructure round trip with verified data integrity.
<!-- /readiness-claim -->

<!-- readiness-claim: id=source-control-isolation state=limitation -->

**Current limitation:** GitHub and GitLab provider, installation, callback, and checkout boundaries are not yet fully verified as team-isolated.
<!-- /readiness-claim -->

### Data Ownership

<!-- readiness-claim: id=operator-data-control state=goal -->

**Goal:** Keep deployment state, backups, and operational decisions under the operator's explicit control.
<!-- /readiness-claim -->

The target architecture is self-hosted and Compose-first, with operator-visible backup and recovery evidence. Current evidence and limitations are published in the [production readiness report](https://github.com/DaoFlow-dev/DaoFlow/blob/main/PRODUCTION_READINESS.md).

### Transparency Through Open Source

<!-- readiness-claim: id=open-source-license state=verified -->

**Verified in this repository:** DaoFlow is published under the [Apache License 2.0](https://github.com/DaoFlow-dev/DaoFlow/blob/main/LICENSE), and the repository source is available for inspection.
<!-- /readiness-claim -->

We believe transparency creates trust. When software has access to production infrastructure, operators need clear evidence of what the platform can and cannot do.

### Impact Over Enterprise

DaoFlow aims to become a tool a small team can trust to run production workloads on their own servers. Automation may observe, explain, and assist, but should not be able to casually break production.

The goal is impact: make dependable self-hosted deployments accessible to everyone, not just teams with dedicated DevOps engineers.

### Repeatable Contract Design

<!-- readiness-claim: id=deterministic-deployment-contract state=limitation -->

**Current limitation:** DaoFlow has not yet independently proven deterministic deployment and recovery outcomes across the complete production lifecycle.
<!-- /readiness-claim -->

The target deployment contract is repeatable and evidence-backed:

- `daoflow deploy --compose ./compose.yaml --yes` should have a repeatable, evidence-backed result
- Deployment records should capture exact inputs, resolved configs, and outcomes
- Rollback should target a specific previous deployment rather than use "best effort"
- Exit codes should remain stable: `0` = success, `1` = error, `2` = denied, `3` = dry-run

<!-- readiness-claim: id=interface-parity state=goal -->

**Goal:** Provide one evidence-backed deployment contract for the Web UI, CLI, CI, and constrained automation.
<!-- /readiness-claim -->

## One Deployment Engine, Multiple Interfaces

DaoFlow is designed around these intended outcomes:

1. **The Web UI should become a comprehensive production operator surface** — not a thin wrapper around missing server behavior
2. **GitHub and GitLab should become first-class deployment sources** — commit, branch, pull-request or merge-request, and build status remain traceable
3. **The CLI should reach deployment parity** — using the same plans, permissions, approvals, and records as the Web UI
4. **Automation should be constrained by default** — scoped permissions beat ambient shell access
5. **Self-hosting should remain portable and open** — standard Docker and Compose workloads stay under the operator's control

An agent is one possible CLI/API caller. It should not be a separate deployment system or receive a shortcut around production controls.

## Decision Rules

When we make product or architecture choices, we optimize for these principles:

- Prefer **smaller trusted primitives** over large magical abstractions
- Prefer **durable records** over ephemeral process state
- Prefer **explicit permissions** over convenience shortcuts
- Prefer **structured events** over parsing raw log strings later
- Prefer **one excellent deployment path** over many weak ones
- Prefer **agent safety** over agent convenience

If a feature increases system complexity, it must clearly improve at least one of: deployment reliability, operator clarity, backup safety, agent safety, or auditability. If it does not, we defer it.
