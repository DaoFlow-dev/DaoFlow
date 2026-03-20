---
sidebar_position: 4
---

# Configuration

DaoFlow is configured through environment variables and a CLI config file.

## Environment Variables

### Local Development

| Variable             | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string                               |
| `BETTER_AUTH_URL`    | Public-facing URL of the DaoFlow instance                  |
| `BETTER_AUTH_SECRET` | Optional locally, required in production                   |
| `ENCRYPTION_KEY`     | Optional locally, recommended for realistic secret testing |

### Production `.env`

The generated production `.env` file is intentionally smaller than the runtime environment inside the container. The compose stack derives `DATABASE_URL`, `REDIS_URL`, and most container-local defaults internally.

Most operators edit only these values:

| Variable                     | Default               | Description                                      |
| ---------------------------- | --------------------- | ------------------------------------------------ |
| `DAOFLOW_VERSION`            | `latest`              | Image tag to run                                 |
| `BETTER_AUTH_URL`            | —                     | Public origin used for sign-in and callbacks     |
| `DAOFLOW_PORT`               | `3000`                | Host port bound to the DaoFlow container         |
| `BETTER_AUTH_SECRET`         | —                     | Production session signing secret                |
| `ENCRYPTION_KEY`             | —                     | Production secret-encryption key                 |
| `POSTGRES_PASSWORD`          | —                     | Password for the DaoFlow application database    |
| `TEMPORAL_POSTGRES_PASSWORD` | —                     | Password for Temporal's Postgres database        |
| `DEPLOY_TIMEOUT_MS`          | `600000`              | Timeout for a single deployment execution        |
| `DAOFLOW_ENABLE_TEMPORAL`    | `false`               | Enables durable Temporal-backed orchestration    |
| `TEMPORAL_NAMESPACE`         | `daoflow`             | Temporal namespace when Temporal mode is enabled |
| `TEMPORAL_TASK_QUEUE`        | `daoflow-deployments` | Temporal task queue name                         |

### Initial Owner Bootstrap

These variables are optional, but when both are set DaoFlow bootstraps the first owner account on first start:

| Variable                         | Description                          |
| -------------------------------- | ------------------------------------ |
| `DAOFLOW_INITIAL_ADMIN_EMAIL`    | Email for the first owner account    |
| `DAOFLOW_INITIAL_ADMIN_PASSWORD` | Password for the first owner account |

The CLI install flow also reads these same variables when `--email` and `--password` are omitted, then writes them into the generated server `.env` file.

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
