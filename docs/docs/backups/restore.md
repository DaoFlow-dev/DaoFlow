---
sidebar_position: 4
---

# Restore

Restoring from a backup creates a new operation record with full audit trail.

## CLI Usage

```bash
# Restore from a specific backup
daoflow backup restore --backup-run-id bkp_run_123 --yes

# Preview restore plan
daoflow backup restore --backup-run-id bkp_run_123 --dry-run --json
```

## Restore Process

1. **Validate** — verify the backup run exists, succeeded, and has an artifact path
2. **Queue** — create a restore request record with full audit trail
3. **Fetch** — resolve the backup artifact from the configured destination
4. **Execute** — run the restore workflow and record status updates
5. **Verify** — capture completion or failure in restore metadata
6. **Record** — keep the restore request and source backup run immutable

## Approval Gates

Restore operations may require approval depending on your configuration:

```bash
# If approval is required, the control plane records the request
daoflow backup restore --backup-run-id bkp_run_123 --yes
# Review and decide the request through the dashboard or the
# `requestApproval` / `approveApprovalRequest` API procedures.
```

## Required Scopes

- `backup:restore` — to initiate a restore
- `approvals:create` — to create approval requests (if gated)

## Safety

- Restoring creates a new operation record (never modifies existing)
- The original backup artifact is never modified
- Restore status is recorded even when application-specific rehydration still requires operator follow-through
- All restores appear in the audit trail
