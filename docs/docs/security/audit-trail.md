---
sidebar_position: 6
---

# Audit Trail

Every command-lane mutation in DaoFlow enters an enforced, append-only audit boundary before validation, authorization, or external work begins. Existing domain events remain visible alongside this command trail.

## Audit Record Schema

| Field             | Description                                       |
| ----------------- | ------------------------------------------------- |
| `actorType`       | `user`, `agent`, `system`, or `token`             |
| `actorId`         | Principal ID who performed the action             |
| `actorEmail`      | Actor's email (if applicable)                     |
| `actorRole`       | Role at the time of the action                    |
| `organizationId`  | Organization context                              |
| `targetResource`  | Resource affected (e.g., `deployment:dep_abc123`) |
| `action`          | What happened (e.g., `deployment.created`)        |
| `inputSummary`    | Summary of input parameters                       |
| `permissionScope` | Scope used to authorize                           |
| `outcome`         | Attempt, denial, acceptance, success, or failure  |
| `createdAt`       | Timestamp (ISO 8601)                              |

## Viewing Audit Logs

### Via Dashboard

Navigate to **Settings → Security** to see the audit trail table.

Request/access logs are separate from audit records. Use the Requests dashboard when you need redacted HTTP request history, failed authentication attempts, denied scopes, webhook traffic, slow requests, or API token usage.

### Via API

```bash
GET /trpc/auditTrail?input={"json":{"limit":50}}
GET /trpc/auditTrail?input={"json":{"limit":20,"since":"1h"}}
```

### Via CLI

```bash
daoflow audit --limit 20
daoflow audit --since 1h
daoflow audit --limit 20 --json
```

The CLI returns the same audit summary and entry feed exposed through the `auditTrail` API route. The optional `since` window accepts positive durations like `15m`, `1h`, `7d`, or `2w`.

## What Gets Audited

- Server registration, updates, removal
- Deployment creation, cancellation, rollback
- Environment variable changes
- API token creation and revocation
- Role changes and user management
- Backup execution and restore operations
- Approval request creation and decisions
- Pull-request preview origin classification, policy decisions, blocked requests, and the immutable approval binding
- Configuration changes

## Command Lifecycle

Command attempts produce an intent event first. Invalid and denied commands therefore remain visible. Queued work receives a separate `accepted` event. Deployment-backed commands are then reconciled to `succeeded` or `execution_failed` from durable deployment state, and their audit events carry the deployment identifier.

Terminal reconciliation is not yet complete for every asynchronous operation type. Backup, restore, and other queued work can currently remain at `accepted`; issue #208 remains open until each durable operation stores the audit attempt identifier and records its final result.

If a deployment terminal outcome cannot be persisted after work may already have started, DaoFlow preserves the original command response and leaves the intent for operational maintenance to reconcile. This avoids encouraging a dangerous automatic retry.

## Retention

Audit records are stored in PostgreSQL and retained indefinitely. Consider setting up periodic exports for long-term archival.

Request/access logs use their own retention window and can be pruned by operational maintenance. Configure that window with `REQUEST_ACCESS_LOG_RETENTION_DAYS`.

## Security Rules

- Immutable command audit records are protected from update and delete by PostgreSQL
- No secrets appear in audit input summaries
- No shell commands echoed with raw credentials
- No silent privilege escalation without event emission
