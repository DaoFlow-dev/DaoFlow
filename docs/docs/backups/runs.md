---
sidebar_position: 3
---

# Backup Runs

A backup run is a single execution of a backup policy or manual backup.

## Run Schema

| Field         | Description                              |
| ------------- | ---------------------------------------- |
| `id`          | Unique identifier                        |
| `policyId`    | Associated policy (null for manual runs) |
| `status`      | `running`, `completed`, `failed`         |
| `type`        | `database`, `volume`, `full`             |
| `sizeBytes`   | Backup size                              |
| `storagePath` | Where the backup is stored               |
| `startedAt`   | When the run started                     |
| `completedAt` | When the run finished                    |
| `error`       | Error message (if failed)                |

## Manual Backups

```bash
# Run a manual backup
daoflow backup run --service my-app --type full --yes

# Run with JSON output
daoflow backup run --service my-app --type database --json --yes
```

## Viewing Runs

```bash
# List recent backup runs
daoflow backup list --json
```

```json
{
  "ok": true,
  "backups": [
    {
      "id": "bkp_abc123",
      "service": "my-app",
      "type": "full",
      "status": "completed",
      "sizeBytes": 52428800,
      "completedAt": "2026-03-15T02:15:00Z"
    }
  ]
}
```

## Failed Backups

Failed backups are first-class failures — they are visible in the UI, API, and CLI. They are never silently dropped.

```json
{
  "id": "bkp_xyz789",
  "status": "failed",
  "error": "SSH connection timeout to server production-vps",
  "startedAt": "2026-03-15T02:00:00Z"
}
```
