---
sidebar_position: 4
---

# Configuration

DaoFlow is configured through environment variables and a CLI config file.

## Environment Variables

### Local Development

| Variable                                             | Description                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                                       | PostgreSQL connection string                                         |
| `BETTER_AUTH_URL`                                    | Public-facing URL of the DaoFlow instance                            |
| `BETTER_AUTH_SECRET`                                 | Optional locally, required in production                             |
| `ENCRYPTION_KEY`                                     | Optional locally, at least 32 characters in production               |
| `DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY`          | Optional destination-only key; defaults to `ENCRYPTION_KEY`          |
| `DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY` | Temporary old destination key used during rotation                   |
| `DAOFLOW_RECOVERY_ENCRYPTION_KEY`                    | Separate external key used to encrypt control-plane recovery bundles |
| `DAOFLOW_PREVIOUS_RECOVERY_ENCRYPTION_KEY`           | Temporary old recovery key used during rotation                      |
| `DAOFLOW_RCLONE_COMMAND_TIMEOUT_MS`                  | Recovery-object transfer timeout in milliseconds                     |
| `DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB` | Isolated recovery verifier limit in megabytes                        |

### Production `.env`

The generated production `.env` file is intentionally smaller than the runtime environment inside the container. The compose stack derives `DATABASE_URL`, `REDIS_URL`, and most container-local defaults internally.

Most operators edit only these values:

| Variable                                             | Default                      | Description                                                                                         |
| ---------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `DAOFLOW_VERSION`                                    | `0.9.1` in reference Compose | Concrete image tag to run; the installer-generated `.env` pins the installed CLI release            |
| `BETTER_AUTH_URL`                                    | —                            | Public origin used for sign-in and callbacks                                                        |
| `DAOFLOW_DATABASE_NAME`                              | `daoflow`                    | Database selected by the production Compose `DATABASE_URL`; keep the default for a standard install |
| `DAOFLOW_PORT`                                       | `3000`                       | Host port bound to the DaoFlow container                                                            |
| `BETTER_AUTH_SECRET`                                 | —                            | Production session signing secret                                                                   |
| `ENCRYPTION_KEY`                                     | —                            | Global DaoFlow secret-encryption key; keep it unchanged during destination-key rotation             |
| `DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY`          | unset                        | Current backup-destination key; falls back to `ENCRYPTION_KEY`                                      |
| `DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY` | unset                        | Temporary old backup-destination key used only during rotation                                      |
| `DAOFLOW_RECOVERY_ENCRYPTION_KEY`                    | unset                        | Dedicated recovery-bundle encryption key; store it outside the control-plane database               |
| `DAOFLOW_PREVIOUS_RECOVERY_ENCRYPTION_KEY`           | unset                        | Temporary previous recovery key during a controlled key rotation                                    |
| `DAOFLOW_RCLONE_COMMAND_TIMEOUT_MS`                  | `1800000`                    | Maximum time for one recovery-object transfer                                                       |
| `DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB` | `4096`                       | Storage and memory ceiling for each isolated recovery verifier                                      |
| `POSTGRES_PASSWORD`                                  | —                            | Password for the DaoFlow application database                                                       |
| `TEMPORAL_POSTGRES_PASSWORD`                         | —                            | Password for Temporal's Postgres database                                                           |
| `DEPLOY_TIMEOUT_MS`                                  | `86400000`                   | Max queue-wait and execution time; expiry aborts active work                                        |
| `DAOFLOW_ENABLE_TEMPORAL`                            | `false`                      | Enables durable Temporal-backed orchestration                                                       |
| `TEMPORAL_NAMESPACE`                                 | `daoflow`                    | Temporal namespace when Temporal mode is enabled                                                    |
| `TEMPORAL_TASK_QUEUE`                                | `daoflow-deployments`        | Temporal task queue name                                                                            |

### Rotating Backup-Destination Credentials

The destination key is separate from the global `ENCRYPTION_KEY`. Leave
`ENCRYPTION_KEY` unchanged so other DaoFlow secrets continue to use the same
key.

1. Set `DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY` to the new destination key.
   If it is unset, the destination key defaults to `ENCRYPTION_KEY`.
2. Temporarily set `DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY` to the old destination key.
3. Restart DaoFlow or run migration-only mode:

   ```bash
   docker compose run --rm -e DAOFLOW_RUN_MIGRATIONS_ONLY=true daoflow
   ```

   Startup verifies every backup-destination envelope, re-encrypts it
   transactionally with the current destination key, and clears legacy
   plaintext secrets. Mixed or undecryptable state fails closed; a failed
   rotation commits no partial changes.

4. Confirm `/ready` is healthy and run a connection test for every backup
   destination before removing the previous key.
5. Remove `DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY` and restart.

If migration fails before commit, restore the old value as
`DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY` (or unset it if it previously
inherited `ENCRYPTION_KEY`), remove the temporary previous-key variable, and
restart. Do not change the global `ENCRYPTION_KEY` for this rollback.

### Control-plane Recovery Key

`DAOFLOW_RECOVERY_ENCRYPTION_KEY` is independent of both `ENCRYPTION_KEY` and the
backup-destination key. Generate it with `openssl rand -hex 32` and keep it in an external secret
manager. DaoFlow stores only its fingerprint and rotation timestamp. If the key is rotated, supply
the old value as `DAOFLOW_PREVIOUS_RECOVERY_ENCRYPTION_KEY` for the migration window, verify a new
recovery plan, then remove the previous key. Losing this external key makes encrypted recovery
bundles unreadable.

### Initial Owner Bootstrap

These variables are optional, but when both are set DaoFlow bootstraps the first owner account on first start:

| Variable                         | Description                          |
| -------------------------------- | ------------------------------------ |
| `DAOFLOW_INITIAL_ADMIN_EMAIL`    | Email for the first owner account    |
| `DAOFLOW_INITIAL_ADMIN_PASSWORD` | Password for the first owner account |

The CLI install flow also reads these same variables when `--email` and `--password` are omitted, then writes them into the generated server `.env` file.

The environment-created owner is also assigned an owner organization membership and a default
organization before localhost server registration. On restart, DaoFlow repairs an older
environment-created owner that is missing organization membership, while preserving any valid
default organization that is already configured.

### Offline clean-install restore

The offline restore contract uses `daoflow backup recovery restore` with a local bundle, signed
manifest, external secrets file, and a new `--database-name`. Start with `--dry-run --json`, then
run the exact returned plan with `--confirm <exact-plan-hash> --yes --json`. The full command
options are `--dir`, `--bundle`, `--manifest`, `--external-secrets`, `--database-name`,
`--dry-run`, `--confirm`, `--yes`, and `--json`.

Set the external secrets file to mode `600`. It needs `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`,
`DAOFLOW_RECOVERY_ENCRYPTION_KEY`, any manifest-required optional key,
`DAOFLOW_RECOVERY_VERIFY_EMAIL`, and `DAOFLOW_RECOVERY_VERIFY_PASSWORD`. The restore targets a
new database, retains the original database and configuration, and rolls the configuration back
automatically if post-start verification fails. Clean up only a failed target database before a
retry. See [Control-plane Recovery Bundles](/docs/backups/recovery) for the operator sequence.

For the full production variable reference, including SMTP and advanced worker settings, see [Self-Hosting Environment Variables](/docs/self-hosting/environment-variables).

## CLI Configuration

The CLI stores its configuration in `~/.daoflow/config.json`:

```json
{
  "currentContext": "default",
  "contexts": {
    "default": {
      "apiUrl": "http://localhost:3000",
      "token": "your-api-token",
      "authMethod": "api-token"
    }
  }
}
```

The CLI also supports `DAOFLOW_URL` and `DAOFLOW_TOKEN` as environment-based auth for CI and agent workflows. Set both together; if either one is missing, the CLI now fails closed instead of silently falling back to the saved config context.

### Setting CLI Defaults

```bash
# Set the API URL
daoflow login --url https://your-instance.com --token YOUR_TOKEN

# For non-interactive automation
export DAOFLOW_URL=https://your-instance.com
export DAOFLOW_TOKEN=YOUR_TOKEN

# For fresh installs, preseed the first owner
export DAOFLOW_INITIAL_ADMIN_EMAIL=owner@your-instance.com
export DAOFLOW_INITIAL_ADMIN_PASSWORD=replace-this-secret
```

## Server Configuration

Each registered deployment server has configurable settings in the dashboard or admin API:

| Setting            | Default                | Description                       |
| ------------------ | ---------------------- | --------------------------------- |
| SSH Host           | —                      | IP address or hostname            |
| SSH Port           | `22`                   | SSH port                          |
| SSH Private Key    | —                      | Stored SSH private key material   |
| Target Server Name | —                      | Stable name used by deploy plans  |
| Docker Socket      | `/var/run/docker.sock` | Docker socket on the managed host |

## Security Configuration

See the [Security & RBAC guide](/docs/security) for configuring:

- User roles and permissions
- API token scopes
- Agent principal accounts
- Audit log retention
