---
sidebar_position: 6
---

# Approval Gates

Approval gates add a human-in-the-loop for high-risk operations, ensuring agents can request dangerous actions without executing them immediately.

## How It Works

1. Agent previews or prepares a risky action (e.g., backup restore)
2. The agent or UI creates a `requestApproval` record instead of executing immediately
3. A different human with `approvals:decide` scope reviews and approves/rejects
4. If approved, the action executes automatically

The requester cannot approve their own pending request. Approval handoff is part of the safety
model, not an optional convention.

## Gated Actions

| Action                 | Why It's Gated                |
| ---------------------- | ----------------------------- |
| Backup restore         | Could overwrite current data  |
| Server removal         | Removes infrastructure target |
| Production env changes | Could break production        |
| Secret rotation        | Could invalidate integrations |

## CLI Flow

```bash
# Agent previews the restore through the planning lane
daoflow backup restore --backup-run-id bkp_run_123 --dry-run --json

# If a human gate is required, the agent submits the separate approval request
# using the plan's suggested `requestApproval` payload.

# Reviewer checks the queue
daoflow approvals list --limit 10 --json

# A different human reviewer approves or rejects from the CLI
daoflow approvals approve --request apr_xyz789 --yes --json
daoflow approvals reject --request apr_xyz789 --yes --json

# Once approved, an operator or agent with restore scope can queue the restore
# when the gated flow expects a separate restore execution step.
daoflow backup restore --backup-run-id bkp_run_123 --yes --json
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
