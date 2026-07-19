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

## Restoring an External PostgreSQL Archive

An imported archive follows a stricter sequence than a DaoFlow-created backup:

1. Register the exact S3 object under an approved destination prefix.
2. Wait for archive inspection and SHA-256 registration to complete.
3. Run an isolated test restore. The disposable PostgreSQL target has no production network,
   volume, or credentials.
4. Select the intended PostgreSQL target volume and preview the production plan.
5. Request production approval. A different authorized owner or admin approves and dispatches the
   restore.

```bash
daoflow backup external list --json
daoflow backup external verify --artifact-id xba_123 --yes --json

# Read-only plan; exits with the normal dry-run status.
daoflow backup external restore \
  --artifact-id xba_123 \
  --target-volume vol_123 \
  --dry-run \
  --json

# Creates an approval request. It does not restore directly.
daoflow backup external restore \
  --artifact-id xba_123 \
  --target-volume vol_123 \
  --reason "Restore the verified migration archive during the approved window." \
  --yes \
  --json
```

Production planning is unavailable until isolated verification succeeds. The approval snapshot
binds the artifact checksum, S3 version or ETag, destination revision, selected volume, target
server, mount path, and PostgreSQL identity. Any change invalidates dispatch instead of restoring a
different object or target.

## Approval Gates

Approval requests keep the human decision separate while making the approved handoff durable:

```bash
# Preview the restore with a read-only token
daoflow backup restore --backup-run-id bkp_run_123 --dry-run --json

# If your operating procedure requires a human gate, create a separate approval request
# through the `requestApproval` API procedure using the dry-run plan as the input template.

# A different owner or admin approves the request. Approval automatically creates
# a durable restore intent; do not issue a second restore command for that request.
daoflow approvals approve --request apr_123 --yes --json
daoflow approvals list --limit 10 --json
```

The approval queue reports whether the restore intent is pending, retrying, dispatched, succeeded,
or in terminal failure. Temporary submission failures reuse the original operation ID so a restart
or retry cannot create a duplicate restore. A terminal failure before submission can be retried from
the approval dashboard. A restore that was submitted and later failed requires a new approval after
the underlying problem is corrected.

## Required Scopes

- `backup:read` — to preview a restore plan with `--dry-run`
- `backup:restore` — to queue a direct restore or request an external-artifact production restore
- `approvals:create` — to create an approval-gated restore request; external-artifact restores also require `backup:restore`
- `approvals:decide` — to approve, reject, or retry a dispatch that never reached the worker

## Safety

- `--dry-run` uses the API planning lane and does not create a restore record
- Restoring creates a new operation record (never modifies existing)
- Restore execution requires Temporal mode so requests cannot sit in a fake queue
- The original backup artifact is never modified
- External production restores cannot bypass approval
- External object downloads must match the registered version or ETag, size, and SHA-256
- Restore status is recorded even when application-specific rehydration still requires operator follow-through
- All restores appear in the audit trail

## QA Checklist for External Imports

Use an isolated QA Compose project with its own PostgreSQL, Temporal, Redis, S3-compatible test
storage, network, and volumes. Do not point a feature branch at a shared database with a different
migration chain.

1. Upload a small custom-format `pg_dump` archive under the approved prefix.
2. Confirm an outside-prefix key, missing identity, oversized object, and plain SQL dump are rejected.
3. Register the valid archive and confirm its pinned identity and SHA-256 are visible.
4. Run the isolated test restore and verify expected schemas/tables plus unchanged live-database
   sentinel data.
5. Preview production restore against a disposable target, request approval, approve with a second
   actor, and verify the expected data.
6. Confirm temporary download files and verifier containers are removed after both success and
   forced failure.
