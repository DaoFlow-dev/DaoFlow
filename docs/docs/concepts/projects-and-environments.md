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

An explicitly modeled project is not deployable yet until it has at least one service. The
supported bootstrap path is: project, environment, first service, plan, then deploy.

## Canonical First-Project Journeys

### Web Setup Wizard

1. Open `/setup`.
2. Register the first server.
3. Create the first project.
4. Create the first environment.
5. Use the handoff step to either open **Create First Service** on the new project or go straight
   to **Deploy from Template** with the project, environment, and server context already selected.

### CLI Explicit Bootstrap

```bash
daoflow projects create --name demo --yes --json
daoflow projects env create --project proj_123 --name production --yes --json
daoflow services create --project proj_123 --environment env_123 --name web --source-type image --image ghcr.io/acme/web:latest --yes --json
daoflow plan --service svc_123 --json
daoflow deploy --service svc_123 --yes --json
```

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
Model in Dashboard / Direct Compose Intake → Configure Environment → Bootstrap First Service → Preview and Deploy → Monitor → Update → Rollback
```

1. **Create** — Set up project records explicitly in the dashboard, or let direct Compose intake create them.
2. **Configure** — Add or adjust environments and environment variables.
3. **Bootstrap** — Add the first service explicitly or continue into a template-backed deployment.
4. **Deploy** — Preview the plan, then push a deployment to an environment.
5. **Monitor** — View logs, health, and deployment history.
6. **Iterate** — Update configuration, redeploy, or rollback.

When you return to an environment later, the project detail service list also surfaces the current canonical endpoint or published port summary for each service, so the "what is live now?" answer stays visible outside the deployment history view.
