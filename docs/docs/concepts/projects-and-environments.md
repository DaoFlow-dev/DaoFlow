---
sidebar_position: 2
---

# Projects and Environments

Projects are the top-level organizational unit in DaoFlow. Each project can have multiple environments, and each environment can have multiple services.

## Projects

A project represents a deployable application or system. It groups related services, environments, and deployment history together.

| Field | Description |
|-------|-------------|
| Name | Human-readable project name (e.g., `my-web-app`) |
| Slug | URL-safe identifier (auto-generated) |
| Repository URL | Optional Git repository for source-based deployments |
| Source Type | `compose`, `dockerfile`, or `image` |
| Team | The team/organization that owns this project |

### Creating Projects

```bash
# Via CLI
daoflow projects create --name my-web-app --yes

# With a Git repository
daoflow projects create \
  --name my-api \
  --repo https://github.com/org/my-api \
  --yes
```

### Listing Projects

```bash
daoflow projects --json
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

Environments represent deployment targets within a project — typically `production`, `staging`, and `development`.

Each environment:
- Has its own set of environment variables
- Can target a different server
- Maintains independent deployment history
- Inherits project configuration with overrides

### Environment Variables

```bash
# List env vars for a project environment
daoflow env list --project my-web-app --env production --json

# Set an env var
daoflow env set --project my-web-app --env production \
  DATABASE_URL=postgresql://... --yes

# Delete an env var
daoflow env delete --project my-web-app --env production \
  OLD_VARIABLE --yes
```

Environment variable values are encrypted at rest using the `ENCRYPTION_KEY` configured in your DaoFlow instance.

## Project Lifecycle

```
Create Project → Add Environment → Deploy Service → Monitor → Update → Rollback
```

1. **Create** — Set up project with name, repo, and source type
2. **Configure** — Add environments and environment variables
3. **Deploy** — Push a deployment to an environment
4. **Monitor** — View logs, health, and deployment history
5. **Iterate** — Update configuration, redeploy, or rollback
