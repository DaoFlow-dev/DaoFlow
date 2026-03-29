---
sidebar_position: 12
---

# daoflow approvals

Review queued approval requests and record the human decision from the CLI.

## Subcommands

### approvals list

List the current approval queue.

```bash
daoflow approvals list --limit 10 --json
```

**Required scope:** any valid token

### approvals approve

Approve a queued request. Confirmation is required.

```bash
daoflow approvals approve --request apr_123 --yes --json
```

**Required scope:** `approvals:decide`

### approvals reject

Reject a queued request. Confirmation is required.

```bash
daoflow approvals reject --request apr_123 --yes --json
```

**Required scope:** `approvals:decide`

## Options

| Flag             | Description                              |
| ---------------- | ---------------------------------------- |
| `--limit <n>`    | Max queue entries to show for `list`     |
| `--request <id>` | Approval request ID for `approve/reject` |
| `--yes`          | Required confirmation for decisions      |
| `--json`         | Structured JSON output                   |

## JSON Output

### list

```json
{
  "ok": true,
  "data": {
    "limit": 10,
    "summary": {
      "totalRequests": 4,
      "pendingRequests": 2,
      "approvedRequests": 1,
      "rejectedRequests": 1,
      "criticalRequests": 1
    },
    "requests": [
      {
        "id": "apr_123",
        "actionType": "backup-restore",
        "targetResource": "backup-run/bkr_123",
        "resourceLabel": "postgres-volume@production-us-west",
        "riskLevel": "critical",
        "status": "pending",
        "statusTone": "failed",
        "requestedBy": "agent@daoflow.local",
        "reason": "Restore after failed migration.",
        "commandSummary": "Restore backup artifact to foundation-vps-1:/var/lib/postgresql/data.",
        "requestedAt": "2026-03-29T12:00:00.000Z",
        "expiresAt": "2026-03-29T19:00:00.000Z",
        "recommendedChecks": [
          "Confirm the target volume is isolated from live writes before replaying snapshot data."
        ]
      }
    ]
  }
}
```

### approve/reject

```json
{
  "ok": true,
  "data": {
    "request": {
      "id": "apr_123",
      "actionType": "backup-restore",
      "targetResource": "backup-run/bkr_123",
      "resourceLabel": "postgres-volume@production-us-west",
      "status": "approved",
      "statusTone": "healthy",
      "reason": "Restore after failed migration.",
      "decidedBy": "ops@daoflow.local",
      "decidedAt": "2026-03-29T12:30:00.000Z"
    }
  }
}
```

## Notes

- `approvals list` is a read-only view of the queue
- `approvals approve` and `approvals reject` require `--yes` and fail before any API call if confirmation is missing
- Permission errors keep the exact scope details in JSON mode so an agent can tell whether it needs `approvals:decide`
