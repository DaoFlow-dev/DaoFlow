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

The CLI now supports explicit project and environment management in the same scoped control plane:

- `daoflow projects list`
- `daoflow projects show <project-id>`
- `daoflow projects create --yes`
- `daoflow projects delete --project <project-id> --yes`
- `daoflow projects env create|list|update|delete`

### Listing Projects

```bash
daoflow projects list --json
```

```json
{
  "ok": true,
  "data": {
    "summary": {
      "totalProjects": 1,
      "totalEnvironments": 2,
      "totalServices": 3
    },
    "projects": [
      {
        "id": "proj_abc123",
        "name": "my-web-app",
        "environmentCount": 2,
        "serviceCount": 3,
        "status": "active"
      }
    ]
  }
}
```

## Environments

Environments represent deployment targets within a project, typically `production`, `staging`, and `development`.

Each environment:

- has its own set of environment variables
- can target a different server
- maintains independent deployment history
- inherits project-level Compose configuration with per-environment server, compose-file, and compose-profile overrides

### Managing Environment Overrides

```bash
# Create an environment that inherits the project defaults
daoflow projects env create --project proj_abc123 --name staging --yes

# Add per-environment Compose and server overrides
daoflow projects env update \
  --environment env_staging_123 \
  --server srv_edge_2 \
  --compose-file compose.yaml \
  --compose-file compose.staging.yaml \
  --compose-profile web \
  --yes
```

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
