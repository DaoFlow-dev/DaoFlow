---
sidebar_position: 3
---

# First Deployment

This guide walks you through deploying your first application with DaoFlow.

## Prerequisites

- DaoFlow running locally or on a server ([Installation](./installation))
- A server registered with DaoFlow (or use the local Docker engine)
- A Docker Compose file or Docker image to deploy

## Step 1: Register a Server

Before deploying, you need a target server. Today, server registration happens through the dashboard or admin API. The CLI provides read and deploy flows, but not server creation yet.

### Via Dashboard

1. Navigate to **Servers** in the sidebar
2. Click **Add Server**
3. Enter the server name, host IP, and SSH key
4. DaoFlow will verify SSH connectivity and detect Docker

Verify the server is connected:

```bash
daoflow status --json
```

## Step 2: Choose a Deployment Path

You can either:

- deploy a Compose file directly, letting DaoFlow infer project, environment, and service records
- deploy an existing DaoFlow service definition that you already created in the dashboard

For a first greenfield rollout, the direct Compose path is the shortest path.

## Step 3: Deploy

### Docker Compose Preview

Create a `compose.yaml` for your application:

```yaml
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
```

Preview it:

```bash
# Preview the deployment plan (safe, no changes)
daoflow deploy \
  --server srv_my_vps \
  --compose ./compose.yaml \
  --dry-run

# Execute the deployment
daoflow deploy \
  --server srv_my_vps \
  --compose ./compose.yaml \
  --yes
```

The dry-run response tells you whether DaoFlow will create a new project, environment, and service record for this stack and whether local build contexts must be bundled and uploaded.

### Existing Service Deployment

If you already modeled a service in the dashboard, deploy it by service ID:

```bash
daoflow deploy \
  --service svc_my_api \
  --image ghcr.io/myorg/my-api:latest \
  --yes
```

## Step 4: Verify

Check the deployment status:

```bash
# View logs for the queued deployment
daoflow logs --deployment <deployment-id> --json

# Check server status
daoflow status --json
```

Or view it in the dashboard under **Deployments**.

## Step 5: Rollback (If Needed)

If something goes wrong, roll back to the previous deployment:

```bash
# List rollback targets for the existing service
daoflow rollback --service svc_my_web_app --json

# Preview the rollback
daoflow rollback --service svc_my_web_app --target <deployment-id> --dry-run

# Execute the rollback
daoflow rollback --service svc_my_web_app --target <deployment-id> --yes
```

## What's Next?

- [Configure environment variables and settings →](./configuration)
- [Learn about deployment models →](/docs/deployments)
- [Set up backups →](/docs/backups)
