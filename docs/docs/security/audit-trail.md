---
sidebar_position: 6
---

# Audit Trail

Every write operation in DaoFlow generates an immutable audit record.

## Audit Record Schema

| Field | Description |
|-------|-------------|
| `actorType` | `user`, `agent`, `system`, or `token` |
| `actorId` | Principal ID who performed the action |
| `actorEmail` | Actor's email (if applicable) |
| `actorRole` | Role at the time of the action |
| `organizationId` | Organization context |
| `targetResource` | Resource affected (e.g., `deployment:dep_abc123`) |
| `action` | What happened (e.g., `deployment.created`) |
| `inputSummary` | Summary of input parameters |
| `permissionScope` | Scope used to authorize |
| `outcome` | `success` or `failure` |
| `createdAt` | Timestamp (ISO 8601) |

## Viewing Audit Logs

### Via Dashboard

Navigate to **Settings → Security** to see the audit trail table.

### Via API

```bash
GET /trpc/auditLog?input={"json":{"limit":50}}
```

### Via CLI

```bash
daoflow audit --json --limit 50
```

## What Gets Audited

- Server registration, updates, removal
- Deployment creation, cancellation, rollback
- Environment variable changes
- API token creation and revocation
- Role changes and user management
- Backup execution and restore operations
- Approval request creation and decisions
- Configuration changes

## Retention

Audit records are stored in PostgreSQL and retained indefinitely. Consider setting up periodic exports for long-term archival.

## Security Rules

- Audit records are append-only (never modified or deleted)
- No secrets appear in audit input summaries
- No shell commands echoed with raw credentials
- No silent privilege escalation without event emission
