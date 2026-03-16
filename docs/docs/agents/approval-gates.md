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

| Action | Why It's Gated |
|--------|---------------|
| Backup restore | Could overwrite current data |
| Server removal | Removes infrastructure target |
| Production env changes | Could break production |
| Secret rotation | Could invalidate integrations |

## CLI Flow

```bash
# Agent requests a restore (gated)
daoflow backup restore --backup bkp_abc123 --yes
# Output: "Approval required. Request: apr_xyz789"

# Human reviews and approves
daoflow approve apr_xyz789 --yes
# Output: "Approved. Restore executing."

# Or rejects
daoflow reject apr_xyz789 --reason "Wrong backup" --yes
```

## API Flow

```bash
# Create approval request
POST /trpc/createApprovalRequest
{
  "json": {
    "action": "backup:restore",
    "targetResource": "bkp_abc123",
    "reason": "Restoring after failed migration"
  }
}

# Approve
POST /trpc/updateApprovalRequest
{
  "json": { "id": "apr_xyz789", "action": "approve" }
}
```

## Required Scopes

| Action | Scope |
|--------|-------|
| Create request | `approvals:create` |
| Approve/reject | `approvals:decide` |

## Configuration

Approval gates can be configured per environment:

- **Production**: all destructive actions gated
- **Staging**: only backup restores gated
- **Development**: no gates
