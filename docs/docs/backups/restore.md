---
sidebar_position: 4
---

# Restore

Restoring from a backup creates a new operation record with full audit trail. Previewing a restore is a separate non-mutating planning call.

The service detail **Backups** tab follows the same rule: a successful backup run must be previewed
before the restore action appears in the service workflow. The preview resolves the artifact, target
path, verification state, and prior restore count without creating a restore request.

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
4. **Dispatch** — start the Temporal restore workflow for the queued restore request
5. **Fetch** — resolve the backup artifact from the configured destination
6. **Execute** — run the restore workflow and record status updates
7. **Verify** — capture completion or failure in restore metadata
8. **Record** — keep the restore request and source backup run immutable

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
- Restore execution requires Temporal mode so requests cannot sit in a fake queue
- The original backup artifact is never modified
- Restore status is recorded even when application-specific rehydration still requires operator follow-through
- All restores appear in the audit trail
