---
sidebar_position: 6
---

# daoflow audit

Read the immutable audit trail from the control plane.

## Usage

```bash
daoflow audit [options]
```

## Options

| Flag          | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| `--limit <n>` | Show up to 50 of the newest entries                                      |
| `--since <w>` | Only include entries newer than a window like `15m`, `1h`, `7d`, or `2w` |
| `--json`      | Structured JSON output                                                   |

## Required Scope

Any valid session or API token.

## Examples

```bash
# Show the newest audit entries
daoflow audit --limit 20

# Return the audit feed as JSON
daoflow audit --limit 20 --json

# Only show the last hour of audit activity
daoflow audit --since 1h --json
```

## JSON Output

```json
{
  "ok": true,
  "data": {
    "limit": 20,
    "since": "1h",
    "summary": {
      "totalEntries": 42,
      "deploymentActions": 12,
      "executionActions": 18,
      "backupActions": 4,
      "humanEntries": 9
    },
    "entries": [
      {
        "id": "audit_123",
        "actorType": "user",
        "actorId": "user_123",
        "actorEmail": "owner@daoflow.local",
        "actorRole": "owner",
        "organizationId": "org_123",
        "targetResource": "deployment/dep_123",
        "action": "deployment.created",
        "inputSummary": "Queued deployment for web.",
        "permissionScope": "deploy:start",
        "outcome": "success",
        "metadata": {
          "resourceType": "deployment",
          "resourceId": "dep_123"
        },
        "createdAt": "2026-03-29T12:00:00.000Z",
        "actorLabel": "owner@daoflow.local",
        "resourceType": "deployment",
        "resourceId": "dep_123",
        "resourceLabel": "deployment/dep_123",
        "statusTone": "healthy",
        "detail": "Queued deployment for web."
      }
    ]
  }
}
```

If you use `--since`, the window must be a positive duration ending in `m`, `h`, `d`, or `w`, such as `15m`, `1h`, `7d`, or `2w`.
