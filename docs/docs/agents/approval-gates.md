---
sidebar_position: 6
---

# Approval Gates

Approval gates add a human-in-the-loop for high-risk operations, ensuring agents can request dangerous actions without executing them immediately.

## How It Works

1. Agent requests a risky action (e.g., backup restore)
2. DaoFlow creates an approval request instead of executing
3. A human with `approvals:decide` scope reviews and approves/rejects
4. If approved, the action executes automatically

## Gated Actions

| Action                 | Why It's Gated                |
| ---------------------- | ----------------------------- |
| Backup restore         | Could overwrite current data  |
| Server removal         | Removes infrastructure target |
| Production env changes | Could break production        |
| Secret rotation        | Could invalidate integrations |

## CLI Flow

```bash
# Agent requests a restore through the API-backed CLI
daoflow backup restore --backup-run-id bkp_run_123 --yes --json
# The response includes the queued restore or the approval-request context returned by the control plane.

# Human reviewer then approves through the dashboard or API.
```

## API Flow

```bash
# Create approval request for a restore
POST /trpc/requestApproval
{
  "json": {
    "actionType": "backup-restore",
    "backupRunId": "bkp_run_123",
    "reason": "Restoring after failed migration"
  }
}

# Approve
POST /trpc/approveApprovalRequest
{
  "json": { "requestId": "apr_xyz789" }
}

# Reject
POST /trpc/rejectApprovalRequest
{
  "json": { "requestId": "apr_xyz789" }
}
```

## Required Scopes

| Action         | Scope              |
| -------------- | ------------------ |
| Create request | `approvals:create` |
| Approve/reject | `approvals:decide` |

## Configuration

Approval gates can be configured per environment:

- **Production**: all destructive actions gated
- **Staging**: only backup restores gated
- **Development**: no gates
