---
sidebar_position: 5
---

# Control-plane Recovery Bundles

Control-plane recovery bundles preserve the DaoFlow database state needed to rebuild an instance:
projects, servers, ownership, scopes, audit history, migration state, and backup records. Each
bundle is encrypted, versioned, checksummed, uploaded to an existing backup destination, and
verified by restoring it into an isolated database.

The bundle catalog is not the source of truth during a disaster. DaoFlow also writes a deterministic
sidecar manifest so an operator can discover the bundle and its compatibility information when the
original control-plane database is unavailable.

## Before the incident

Configure and protect a separate recovery key:

```bash
export DAOFLOW_RECOVERY_ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

Store the key in an external secret manager. DaoFlow records only its fingerprint and rotation
metadata. Do not put the recovery key, destination credentials, secret values, or SSH private keys
in a bundle, ticket, log, or incident note.

Use the operator page at **Backups → Control-plane recovery**, or the CLI:

```bash
daoflow backup recovery plan --destination <destination-id> --json
daoflow backup recovery run --destination <destination-id> --dry-run --json
daoflow backup recovery run --destination <destination-id> --yes
daoflow backup recovery list --json
```

Do not treat a queued or running status as success. A bundle is ready only when its checksum and
isolated restore verification pass.

For large databases or slow destinations, set
`DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB` above the restored database footprint and
increase `DAOFLOW_RCLONE_COMMAND_TIMEOUT_MS` as needed. Both values are bounded; exceeding either
limit fails the bundle instead of reporting a partial recovery point.

## Inspecting evidence

```bash
daoflow backup recovery inspect --bundle <bundle-id> --json
daoflow backup recovery download-metadata --bundle <bundle-id> --json
```

Safe metadata includes the bundle ID and status, DaoFlow application and schema versions, key
fingerprint, object paths, checksums, required external secret names, compatibility information,
and verification checks. Required external secret names are references only; their values are not
exported.

## Data deliberately reset in the bundle

Recovery keeps password hashes and encrypted configuration, then proves representative encrypted
values can be opened with the operator-supplied keys. It deliberately removes live sessions,
one-time verification records, CLI login requests, MFA secrets and enrollment state, provider setup
state, notification webhook URLs and delivery logs, web-push subscriptions, and legacy plaintext
destination credentials.

After a clean-install restore, sign in with the existing owner password, re-enroll MFA, and
reconfigure notification webhooks and browser push subscriptions. Treat these steps as required
recovery work, not missing bundle data.

## Failure handling

If planning reports a blocker, correct the destination, key configuration, compatibility, or
required external secret availability named in the plan, then run the plan again. If upload or
verification fails, keep the failed bundle record and capture its failure next steps. Never mark a
failed or unverified bundle as a recovery point by hand.

Live clean-install restoration is intentionally separate from bundle creation and verification.
Follow the live restore procedure tracked for the disaster-recovery workstream before writing into
any production database.

## Offline clean-install restore

When the original control plane is unavailable, the clean-install restore contract uses three local
inputs: the recovery bundle, its signed manifest, and an external secrets file. Create the secrets
file outside the bundle and restrict it before use:

```bash
chmod 600 /secure/daoflow-recovery.env
```

The file must provide `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`,
`DAOFLOW_RECOVERY_ENCRYPTION_KEY`, any optional key required by the manifest,
`DAOFLOW_RECOVERY_VERIFY_EMAIL`, and `DAOFLOW_RECOVERY_VERIFY_PASSWORD`. Keep the file external
to the bundle and do not copy its values into incident notes or command output.

Use the intended restore command path. First create a read-only plan and record the plan hash it
returns:

```bash
daoflow backup recovery restore \
  --dir /srv/daoflow-recovery \
  --bundle ./bundle.dfr \
  --manifest ./latest.json \
  --external-secrets /secure/daoflow-recovery.env \
  --database-name daoflow_recovery_20260718 \
  --dry-run \
  --json
```

Execute only the exact plan that was reviewed, supplying its returned hash to `--confirm` together
with `--yes`:

```bash
daoflow backup recovery restore \
  --dir /srv/daoflow-recovery \
  --bundle ./bundle.dfr \
  --manifest ./latest.json \
  --external-secrets /secure/daoflow-recovery.env \
  --database-name daoflow_recovery_20260718 \
  --confirm <exact-plan-hash-from-dry-run> \
  --yes \
  --json
```

The target must be a new database. The original database and original configuration remain in
place. If post-start verification fails, the configuration is rolled back automatically. Before a
retry, identify and clean up only the failed target database named by `--database-name`; never
delete the original database or configuration. Keep the bundle, signed manifest, and failure
details until the recovery is complete.

## Permissions

All recovery operations are owner-only on the server. Read operations require `backup:read` and a
live bundle run requires `backup:run`. The dry-run plan is read-only and does not mutate the
destination or the control-plane database.
