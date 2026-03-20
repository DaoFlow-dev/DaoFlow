---
sidebar_position: 1
---

# Backup & Restore

Persistent data is a core feature in DaoFlow. The backup system supports database dumps, volume archives, and S3-compatible remote storage.

## Overview

| Feature                    | Description                                      |
| -------------------------- | ------------------------------------------------ |
| [Policies](./policies)     | Define what to backup, when, and retention rules |
| [Runs](./runs)             | View backup execution history                    |
| [Restore](./restore)       | Restore from a specific backup                   |
| [S3 Storage](./s3-storage) | Configure remote backup storage                  |

## Backup Types

| Type                | What It Captures                                |
| ------------------- | ----------------------------------------------- |
| **Database dump**   | Logical dump of PostgreSQL databases            |
| **Volume archive**  | Tar archive of Docker named volumes             |
| **Compose package** | Full service state including config and volumes |

## Quick Start

```bash
# Run a manual backup
daoflow backup run --policy bkp_pol_123 --yes

# List recent backups
daoflow backup list --json

# Restore from a backup
daoflow backup restore --backup-run-id bkp_run_123 --yes
```

## Permissions

| Action              | Required Scope   |
| ------------------- | ---------------- |
| View policies       | `backup:read`    |
| View backup history | `backup:read`    |
| Run a backup        | `backup:run`     |
| Restore a backup    | `backup:restore` |
