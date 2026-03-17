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

Before deploying, you need a target server. Register one via the dashboard or CLI:

### Via Dashboard

1. Navigate to **Servers** in the sidebar
2. Click **Add Server**
3. Enter the server name, host IP, and SSH key
4. DaoFlow will verify SSH connectivity and detect Docker

### Via CLI

```bash
daoflow server add \
  --name my-vps \
  --host 1.2.3.4 \
  --ssh-key ~/.ssh/id_ed25519 \
  --yes
```

Verify the server is connected:

```bash
daoflow status --json
```

## Step 2: Create a Project

### Via Dashboard

1. Navigate to **Projects** in the sidebar
2. Click **New Project**
3. Enter a name and optional Git repository URL

### Via CLI

```bash
daoflow projects create --name my-web-app --yes
```

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
  --server my-vps \
  --compose ./compose.yaml \
  --dry-run

# Execute the deployment
daoflow deploy \
  --server my-vps \
  --compose ./compose.yaml \
  --yes
```

### Image-Based Deployment

For pre-built images:

```bash
daoflow deploy \
  --service my-api \
  --server my-vps \
  --image ghcr.io/myorg/my-api:latest \
  --yes
```

## Step 4: Verify

Check the deployment status:

```bash
# View deployment history
daoflow logs --service my-web-app --json

# Check server status
daoflow status --json
```

Or view it in the dashboard under **Deployments**.

## Step 5: Rollback (If Needed)

If something goes wrong, roll back to the previous deployment:

```bash
# Preview the rollback
daoflow rollback --service my-web-app --dry-run

# Execute the rollback
daoflow rollback --service my-web-app --yes
```

## What's Next?

- [Configure environment variables and settings →](./configuration)
- [Learn about deployment models →](/docs/deployments)
- [Set up backups →](/docs/backups)
