---
sidebar_position: 1
---

# Backup & Restore

Persistent data is a core feature in DaoFlow. The backup system supports database dumps, volume archives, and S3-compatible remote storage.

When `DAOFLOW_ENABLE_TEMPORAL=true`, both scheduled backups and one-off `backup run` executions are
dispatched through Temporal. The operator backup surfaces expose the backing workflow ID so you can
jump directly into Temporal Web when a run needs deeper diagnosis.

When Temporal mode is disabled, one-off backup requests fail fast instead of being silently queued
without an execution engine behind them. Enable `DAOFLOW_ENABLE_TEMPORAL=true` before relying on
manual `backup run` or restore operations.

## Overview

| Feature                              | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| [Policies](./policies)               | Define what to backup, when, and retention rules |
| [Runs](./runs)                       | View backup execution history                    |
| [Restore](./restore)                 | Restore from a specific backup                   |
| [S3 Storage](./s3-storage)           | Configure storage and approved archive imports   |
| [Control-plane recovery](./recovery) | Create and verify DaoFlow recovery bundles       |

## Service Detail Workflow

Each service detail page has a **Backups** tab for the volumes linked to that service. The tab shows
volume coverage, size, destination, retention, recent backup status, and restore history next to the
service itself. Operators can run a service volume backup from the policy list, inspect failed run
logs, preview a successful run's restore target and preflight checks, then queue the restore from the
preview panel.

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

# Register and test an existing PostgreSQL custom archive from approved S3 storage
daoflow backup external register \
  --destination dest_123 \
  --object-key database-imports/customer.dump \
  --postgres-major 17 \
  --yes
daoflow backup external verify --artifact-id xba_123 --yes

# Plan and run a control-plane recovery bundle
daoflow backup recovery plan --destination dest_123 --json
daoflow backup recovery run --destination dest_123 --yes
```

## Permissions

| Action                             | Required Scope   |
| ---------------------------------- | ---------------- |
| View policies                      | `backup:read`    |
| View backup history                | `backup:read`    |
| Preview restore                    | `backup:read`    |
| Run a backup                       | `backup:run`     |
| Restore a backup                   | `backup:restore` |
| Plan/list/inspect recovery bundles | `backup:read`    |
| Run a recovery bundle              | `backup:run`     |
