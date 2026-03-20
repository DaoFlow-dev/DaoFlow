---
sidebar_position: 4
---

# Environment Variables

Complete reference for the `.env` file consumed by the production `docker-compose.yml`.

## Required In The Generated `.env`

| Variable                     | Description                              | Example                      |
| ---------------------------- | ---------------------------------------- | ---------------------------- |
| `BETTER_AUTH_SECRET`         | Session signing secret (min 32 chars)    | `openssl rand -hex 32`       |
| `BETTER_AUTH_URL`            | Public URL of DaoFlow instance           | `https://deploy.example.com` |
| `ENCRYPTION_KEY`             | Secret encryption key (exactly 32 chars) | `openssl rand -hex 16`       |
| `POSTGRES_PASSWORD`          | DaoFlow application database password    | `openssl rand -hex 16`       |
| `TEMPORAL_POSTGRES_PASSWORD` | Temporal database password               | `openssl rand -hex 16`       |

`DATABASE_URL`, `REDIS_URL`, and most container-local defaults are constructed inside the compose stack and are not normally hand-authored in this `.env` file.

## Version And Ports

| Variable           | Default  | Description                          |
| ------------------ | -------- | ------------------------------------ |
| `DAOFLOW_VERSION`  | `latest` | DaoFlow image tag                    |
| `DAOFLOW_PORT`     | `3000`   | Host port bound to the control plane |
| `TEMPORAL_UI_PORT` | `8233`   | Host port for Temporal UI            |

## Initial Owner Bootstrap

| Variable                         | Description                   |
| -------------------------------- | ----------------------------- |
| `DAOFLOW_INITIAL_ADMIN_EMAIL`    | Optional first owner email    |
| `DAOFLOW_INITIAL_ADMIN_PASSWORD` | Optional first owner password |

## Execution And Temporal

| Variable                  | Default                               | Description                                   |
| ------------------------- | ------------------------------------- | --------------------------------------------- |
| `DEPLOY_TIMEOUT_MS`       | `600000`                              | Max runtime for one deployment execution      |
| `DAOFLOW_ENABLE_TEMPORAL` | `false`                               | Enables durable Temporal-backed orchestration |
| `TEMPORAL_ADDRESS`        | `temporal:7233` in generated installs | Temporal connection target                    |
| `TEMPORAL_NAMESPACE`      | `daoflow`                             | Temporal namespace                            |
| `TEMPORAL_TASK_QUEUE`     | `daoflow-deployments`                 | Temporal task queue                           |

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

| Variable       | Default                 | Description                                     |
| -------------- | ----------------------- | ----------------------------------------------- |
| `PORT`         | `3000`                  | Internal HTTP port inside the DaoFlow container |
| `NODE_ENV`     | `production` in compose | Runtime mode                                    |
| `GIT_WORK_DIR` | `/app/staging`          | Frozen deploy artifact workspace                |
| `SSH_KEY_DIR`  | `/app/.ssh`             | SSH key storage for managed targets             |
