---
sidebar_position: 2
---

# Projects and Environments

Projects are the top-level organizational unit in DaoFlow. Each project can have multiple environments, and each environment can have multiple services.

## Projects

A project represents a deployable application or system. It groups related services, environments, and deployment history together.

| Field          | Description                                            |
| -------------- | ------------------------------------------------------ |
| Name           | Human-readable project name (for example `my-web-app`) |
| Slug           | URL-safe identifier                                    |
| Repository URL | Optional Git repository for source-based deployments   |
| Source Type    | `compose`, `dockerfile`, or `image`                    |
| Team           | The team or organization that owns this project        |

### Creating Projects

Today, project and environment records are usually created in one of two ways:

- through the dashboard or admin API when an operator wants to model them explicitly
- implicitly from a direct Compose deploy, where DaoFlow creates the project, environment, and service records needed for the incoming stack

The CLI currently exposes project listing, not `projects create`.

### Listing Projects

```bash
daoflow projects list --json
```

```json
{
  "ok": true,
  "projects": [
    {
      "id": "proj_abc123",
      "name": "my-web-app",
      "environmentCount": 2,
      "serviceCount": 3,
      "latestDeploymentStatus": "healthy"
    }
  ]
}
```

## Environments

Environments represent deployment targets within a project, typically `production`, `staging`, and `development`.

Each environment:

- has its own set of environment variables
- can target a different server
- maintains independent deployment history
- inherits project configuration with overrides

### Environment Variables

```bash
# List env vars for an environment
daoflow env list --env-id env_prod_123 --json

# Set an env var
daoflow env set --env-id env_prod_123 \
  --key DATABASE_URL \
  --value postgresql://... \
  --yes

# Delete an env var
daoflow env delete --env-id env_prod_123 \
  --key OLD_VARIABLE \
  --yes
```

Environment variable values are encrypted at rest using the `ENCRYPTION_KEY` configured in your DaoFlow instance.

## Project Lifecycle

```
Model in Dashboard / Direct Compose Intake → Configure Environment → Deploy Service → Monitor → Update → Rollback
```

1. **Create** — Set up project records explicitly in the dashboard, or let direct Compose intake create them.
2. **Configure** — Add or adjust environments and environment variables.
3. **Deploy** — Push a deployment to an environment.
4. **Monitor** — View logs, health, and deployment history.
5. **Iterate** — Update configuration, redeploy, or rollback.
