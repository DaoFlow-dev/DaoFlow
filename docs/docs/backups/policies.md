---
sidebar_position: 2
---

# Backup Policies

Backup policies define automated backup schedules with retention rules.

## Policy Configuration

| Field         | Description                                        |
| ------------- | -------------------------------------------------- |
| **Name**      | Policy identifier                                  |
| **Service**   | Which service to backup                            |
| **Schedule**  | Cron expression (e.g., `0 2 * * *` for 2 AM daily) |
| **Type**      | `database`, `volume`, or `full`                    |
| **Retention** | How many backups to keep (e.g., 7 daily, 4 weekly) |
| **Storage**   | Where to store (local or S3)                       |

## Creating Policies

### Via Dashboard

Navigate to the service's **Backups** tab and click **Create Policy**.

### Via CLI

```bash
daoflow backup schedule enable \
  --policy bkp_pol_123 \
  --cron "0 2 * * *" \
  --yes
```

Today, policy creation happens in the dashboard or admin API. The CLI manages the execution side of
an existing policy by enabling schedules, triggering one-off runs, verifying results, and disabling
automation when needed.

## Retention Rules

| Strategy        | Description                         |
| --------------- | ----------------------------------- |
| **Count-based** | Keep the last N backups             |
| **Time-based**  | Keep backups from the last N days   |
| **Tiered**      | Keep 7 daily + 4 weekly + 3 monthly |

Old backups are automatically pruned after new successful backups complete.

## Required Scope

`backup:read` to view, `backup:run` to create/modify policies.
