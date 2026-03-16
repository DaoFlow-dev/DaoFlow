---
sidebar_position: 4
---

# Restore

Restoring from a backup creates a new operation record with full audit trail.

## CLI Usage

```bash
# Restore from a specific backup
daoflow backup restore --backup bkp_abc123 --yes

# Preview restore plan
daoflow backup restore --backup bkp_abc123 --dry-run --json
```

## Restore Process

1. **Validate** — verify the backup artifact exists and is intact
2. **Stop** — stop the current service containers
3. **Restore** — extract backup data to volumes or import database
4. **Start** — restart the service containers
5. **Verify** — run health checks
6. **Record** — create an audit record of the restore

## Approval Gates

Restore operations may require approval depending on your configuration:

```bash
# If approval is required
daoflow backup restore --backup bkp_abc123 --yes
# → "Approval required. Request created: apr_xyz789"

# Another user approves
daoflow approve apr_xyz789 --yes
# → Restore executes
```

## Required Scopes

- `backup:restore` — to initiate a restore
- `approvals:create` — to create approval requests (if gated)

## Safety

- Restoring creates a new operation record (never modifies existing)
- The original backup artifact is never modified
- Post-restore health checks verify service is functional
- All restores appear in the audit trail
