---
sidebar_position: 3
---

# Backup Runs

A backup run is a single execution of a backup policy.

## Destination Ownership

Backup destinations belong to one team. A policy can select a destination only when its volume's
linked project or service belongs to that same team. Listing, testing, browsing, backing up,
restoring, and retention work all resolve destination credentials through that policy team.

If an older installation has backup destinations that cannot be tied to one real team, the database
upgrade stops with a repair message instead of assigning a placeholder team. Repair the ownership
mapping and run the upgrade again.

## Run Schema

| Field          | Description                                    |
| -------------- | ---------------------------------------------- |
| `id`           | Unique identifier                              |
| `policyId`     | Associated backup policy                       |
| `status`       | `queued`, `running`, `succeeded`, `failed`     |
| `targetType`   | `volume`, `database`, or service-derived scope |
| `sizeBytes`    | Backup size                                    |
| `artifactPath` | Where the backup is stored                     |
| `startedAt`    | When the run started                           |
| `completedAt`  | When the run finished                          |
| `error`        | Error message (if failed)                      |

## Triggering Runs

```bash
# Run a one-off backup from an existing policy
daoflow backup run --policy bkp_pol_123 --yes

# Run with JSON output
daoflow backup run --policy bkp_pol_123 --json --yes
```

## Viewing Runs

```bash
# List recent backup runs
daoflow backup list --json
```

```json
{
  "ok": true,
  "data": {
    "runs": [
      {
        "id": "bkp_run_123",
        "policyId": "bkp_pol_123",
        "serviceName": "my-app",
        "status": "succeeded",
        "artifactPath": "backups/my-app/2026-03-15.tgz",
        "bytesWritten": 52428800,
        "finishedAt": "2026-03-15T02:15:00Z"
      }
    ]
  }
}
```

## Failed Backups

Failed backups are first-class failures — they are visible in the UI, API, and CLI. They are never silently dropped.

```json
{
  "id": "bkp_run_789",
  "status": "failed",
  "error": "SSH connection timeout to server production-vps",
  "startedAt": "2026-03-15T02:00:00Z"
}
```
