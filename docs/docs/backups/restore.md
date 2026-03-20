---
sidebar_position: 4
---

# Restore

Restoring from a backup creates a new operation record with full audit trail. Previewing a restore is a separate non-mutating planning call.

## CLI Usage

```bash
# Restore from a specific backup
daoflow backup restore --backup-run-id bkp_run_123 --yes

# Preview restore plan through the planning lane
daoflow backup restore --backup-run-id bkp_run_123 --dry-run --json
```

## Restore Process

1. **Preview** — use `--dry-run` to fetch the `backupRestorePlan` preview without creating a restore record
2. **Validate** — verify the backup run exists, succeeded, and has an artifact path
3. **Queue** — create a restore request record with full audit trail
4. **Fetch** — resolve the backup artifact from the configured destination
5. **Execute** — run the restore workflow and record status updates
6. **Verify** — capture completion or failure in restore metadata
7. **Record** — keep the restore request and source backup run immutable

## Approval Gates

Approval requests are modeled separately from restore execution:

```bash
# Preview the restore with a read-only token
daoflow backup restore --backup-run-id bkp_run_123 --dry-run --json

# If your operating procedure requires a human gate, create a separate approval request
# through the `requestApproval` API procedure using the dry-run plan as the input template.

# Queue the restore only when you intend to execute it
daoflow backup restore --backup-run-id bkp_run_123 --yes
```

## Required Scopes

- `backup:read` — to preview a restore plan with `--dry-run`
- `backup:restore` — to queue and execute a restore
- `approvals:create` — only for a separate `requestApproval` flow if your operators gate restores manually

## Safety

- `--dry-run` uses the API planning lane and does not create a restore record
- Restoring creates a new operation record (never modifies existing)
- The original backup artifact is never modified
- Restore status is recorded even when application-specific rehydration still requires operator follow-through
- All restores appear in the audit trail
