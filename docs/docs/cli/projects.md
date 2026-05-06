---
sidebar_position: 4
---

# `projects`

Manage scoped DaoFlow projects and project environments from the CLI.

## Required Scopes

- `projects list`
- `projects show`
- `projects env list`
  - `deploy:read`
- `projects create`
- `projects env create`
  - `deploy:start`
- `projects delete`
- `projects env update`
- `projects env delete`
  - `service:update`

## List Projects

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
        "id": "proj_123",
        "name": "demo",
        "description": "Primary app",
        "repoFullName": "acme/demo",
        "repoUrl": "https://github.com/acme/demo",
        "sourceType": "compose",
        "status": "active",
        "statusTone": "healthy",
        "defaultBranch": "main",
        "autoDeploy": true,
        "composeFiles": ["compose.yaml"],
        "composeProfiles": ["web"],
        "environmentCount": 2,
        "serviceCount": 3,
        "createdAt": "2026-03-20T00:00:00.000Z",
        "updatedAt": "2026-03-20T00:00:00.000Z"
      }
    ]
  }
}
```

## Inspect One Project

```bash
daoflow projects show proj_123
```

This prints the project metadata plus the current environment inventory, including per-environment
server and Compose overrides.

## Create A Project

```bash
daoflow projects create \
  --name demo \
  --repo-url https://github.com/acme/demo \
  --default-branch main \
  --compose-file compose.yaml \
  --compose-profile web \
  --dry-run

daoflow projects create \
  --name demo \
  --repo-url https://github.com/acme/demo \
  --yes --json
```

Private generic repositories can attach an encrypted credential without putting secrets in the
repository URL. Prefer file or environment inputs so tokens and keys do not land in shell history.

```bash
# HTTPS token
DAOFLOW_REPO_TOKEN=ghp_redacted \
daoflow projects create \
  --name private-demo \
  --repo-url https://github.com/acme/private-demo \
  --repo-credential-kind https-token \
  --repo-credential-token-env DAOFLOW_REPO_TOKEN \
  --yes

# HTTPS basic auth
DAOFLOW_REPO_PASSWORD=redacted \
daoflow projects create \
  --name basic-demo \
  --repo-url https://git.example.com/acme/basic-demo.git \
  --repo-credential-kind https-basic \
  --repo-credential-username deploy \
  --repo-credential-password-env DAOFLOW_REPO_PASSWORD \
  --yes

# SSH deploy key
daoflow projects create \
  --name ssh-demo \
  --repo-url git@git.example.com:acme/ssh-demo.git \
  --repo-credential-kind ssh-key \
  --repo-credential-ssh-key-file ./deploy-key.pem \
  --yes
```

Dry-run output only shows the credential kind. It does not print token, password, or private-key
material.

## Delete A Project

```bash
daoflow projects delete --project proj_123 --yes --json
```

## Manage Environments

```bash
# List environments for one project
daoflow projects env list --project proj_123 --json

# Create a staging environment that overrides the target server and compose files
daoflow projects env create \
  --project proj_123 \
  --name staging \
  --server srv_edge_2 \
  --compose-file compose.yaml \
  --compose-file compose.staging.yaml \
  --compose-profile web \
  --yes

# Update an environment back to project-level defaults
daoflow projects env update \
  --environment env_123 \
  --clear-server \
  --clear-compose-overrides \
  --yes

# Delete an environment
daoflow projects env delete --environment env_123 --yes --json
```

Environment overrides layer on top of the project defaults. Leaving server, compose-file, or
compose-profile unset means the environment inherits the project-level setting.

For a brand-new project, the next supported step is to register the first service, preview the
rollout, and then deploy it:

```bash
daoflow services create --project proj_123 --environment env_123 --name web --source-type image --image ghcr.io/acme/web:latest --yes --json
daoflow plan --service svc_123 --json
daoflow deploy --service svc_123 --yes --json
```
