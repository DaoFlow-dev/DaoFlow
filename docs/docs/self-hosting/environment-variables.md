---
sidebar_position: 4
---

# Environment Variables

Complete reference for the `.env` file consumed by the production `docker-compose.yml`.

## Required In The Generated `.env`

| Variable             | Description                                                                                                 | Example                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `BETTER_AUTH_SECRET` | Session signing secret (at least 32 chars)                                                                  | `openssl rand -hex 32`       |
| `BETTER_AUTH_URL`    | Public URL of DaoFlow instance                                                                              | `https://deploy.example.com` |
| `ENCRYPTION_KEY`     | Global DaoFlow secret-encryption key; keep it unchanged during destination-key rotation (at least 32 chars) | `openssl rand -hex 32`       |
| `POSTGRES_PASSWORD`  | DaoFlow application database password                                                                       | `openssl rand -hex 16`       |

`DATABASE_URL`, `REDIS_URL`, and most container-local defaults are constructed inside the compose stack and are not normally hand-authored in this `.env` file.

## Backup-Destination Encryption Keys

Backup-destination credentials use `DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY`
when it is set, and otherwise use the global `ENCRYPTION_KEY`.

| Variable                                             | Default          | Description                                                                        |
| ---------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY`          | `ENCRYPTION_KEY` | Current key for backup-destination credential envelopes.                           |
| `DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY` | unset            | Old destination key supplied temporarily while startup rotates existing envelopes. |

To rotate destination credentials, keep `ENCRYPTION_KEY` unchanged, set the new
destination key and the temporary previous key, then run migration-only mode or
restart the service. Startup verifies every envelope, re-encrypts all rows in a
transaction, and clears legacy plaintext destination secrets. Any mixed or
undecryptable state blocks production startup, and a failed rotation leaves the
old ciphertext usable because no partial transaction is committed.

After `/ready` is healthy, test every destination with
`daoflow backup destination test --id <destination-id>`. Only then remove
`DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY` and restart. If the
rotation fails before commit, restore the old destination key as
`DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY` (or unset it to fall back to
`ENCRYPTION_KEY`) and remove the temporary previous key. Do not replace the
global `ENCRYPTION_KEY`.

## Version, Workflow Profile, And Ports

| Variable                   | Lean value  | Temporal value | Description                                                                                                                          |
| -------------------------- | ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `DAOFLOW_VERSION`          | `0.9.1`     | `0.9.1`        | DaoFlow image tag used by the repository production Compose file                                                                     |
| `DAOFLOW_WORKFLOW_PROFILE` | `lean`      | `temporal`     | Installer-selected workflow profile; lean is the default                                                                             |
| `COMPOSE_PROFILES`         | empty       | `temporal`     | Active Compose profiles; the temporal profile adds the Temporal services                                                             |
| `DAOFLOW_ENABLE_TEMPORAL`  | `false`     | `true`         | Selects legacy or Temporal-backed workflow execution                                                                                 |
| `DAOFLOW_BIND`             | `127.0.0.1` | `127.0.0.1`    | Host interface bound to the control plane. Set explicitly, for example to `0.0.0.0`, only when direct public binding is intentional. |
| `DAOFLOW_PORT`             | `3000`      | `3000`         | Host port bound to the control plane                                                                                                 |
| `TEMPORAL_UI_PORT`         | `8233`      | `8233`         | Host port for Temporal UI when its separate Compose profile is enabled                                                               |

The installer persists the three profile values together. Do not enable Temporal by changing only
`DAOFLOW_ENABLE_TEMPORAL`; use `daoflow install --workflow-profile temporal` or set the matching
profile values in `.env`.

## HTTP Origin Controls

| Variable      | Default | Description                                                                                               |
| ------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `CORS_ORIGIN` | unset   | Optional allowed browser origin for API requests when the app is accessed from a separate trusted origin. |

## Initial Owner Bootstrap

| Variable                         | Description                   |
| -------------------------------- | ----------------------------- |
| `DAOFLOW_INITIAL_ADMIN_EMAIL`    | Optional first owner email    |
| `DAOFLOW_INITIAL_ADMIN_PASSWORD` | Optional first owner password |

## Execution And Temporal

| Variable                     | Default                               | Description                              |
| ---------------------------- | ------------------------------------- | ---------------------------------------- |
| `DEPLOY_TIMEOUT_MS`          | `600000`                              | Max runtime for one deployment execution |
| `TEMPORAL_POSTGRES_PASSWORD` | unset in lean; required in temporal   | Temporal database password               |
| `TEMPORAL_ADDRESS`           | `temporal:7233` in generated installs | Temporal connection target               |
| `TEMPORAL_NAMESPACE`         | `daoflow`                             | Temporal namespace                       |
| `TEMPORAL_TASK_QUEUE`        | `daoflow-deployments`                 | Temporal task queue                      |

On an existing install, rerunning the installer without `--workflow-profile` preserves the current
choice and infers older installs from their existing Temporal settings. Switching from temporal to
lean stops and removes the Temporal containers after explaining the plan, while preserving the
`temporal-pgdata` named volume. Temporal UI remains separately opt-in through `temporal-ui`.

Lean can omit `TEMPORAL_POSTGRES_PASSWORD`; the temporal profile requires a non-empty value.

## Email (SMTP)

| Variable        | Description             |
| --------------- | ----------------------- |
| `SMTP_HOST`     | SMTP server hostname    |
| `SMTP_PORT`     | SMTP port               |
| `SMTP_USER`     | SMTP username           |
| `SMTP_PASSWORD` | SMTP password           |
| `SMTP_FROM`     | From address for emails |

## Optional Backup Storage (S3)

| Variable        | Description                |
| --------------- | -------------------------- |
| `S3_ENDPOINT`   | S3-compatible endpoint URL |
| `S3_BUCKET`     | Bucket name for backups    |
| `S3_ACCESS_KEY` | S3 access key              |
| `S3_SECRET_KEY` | S3 secret key              |
| `S3_REGION`     | AWS region (optional)      |

## Advanced Runtime Overrides

These are usually set inside the compose file rather than in your `.env`, but they are part of the runtime contract:

| Variable                            | Default                 | Description                                              |
| ----------------------------------- | ----------------------- | -------------------------------------------------------- |
| `PORT`                              | `3000`                  | Internal HTTP port inside the DaoFlow container          |
| `NODE_ENV`                          | `production` in compose | Runtime mode                                             |
| `GIT_WORK_DIR`                      | `/app/staging`          | Frozen deploy artifact workspace                         |
| `SSH_KEY_DIR`                       | `/app/.ssh`             | SSH key storage for managed targets                      |
| `SERVER_READINESS_POLL_INTERVAL_MS` | `60000`                 | Interval for recurring persisted server readiness checks |
