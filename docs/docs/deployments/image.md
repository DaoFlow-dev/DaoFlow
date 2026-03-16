---
sidebar_position: 4
---

# Image Deployments

Deploy pre-built Docker images directly — the simplest deployment method.

## CLI Deployment

```bash
daoflow deploy \
  --service my-app \
  --server prod \
  --image ghcr.io/myorg/my-app:v1.2.3 \
  --yes
```

## How It Works

1. DaoFlow pulls the image on the target server
2. Stops the existing container (if any)
3. Starts a new container with the pulled image
4. Monitors health and records the outcome

## Image Sources

DaoFlow works with any Docker registry:

| Registry | Example |
|----------|---------|
| Docker Hub | `nginx:alpine` |
| GitHub Container Registry | `ghcr.io/org/app:latest` |
| AWS ECR | `123456.dkr.ecr.us-east-1.amazonaws.com/app:v1` |
| Google Artifact Registry | `us-docker.pkg.dev/project/repo/app:v1` |
| Self-hosted | `registry.example.com/app:v1` |

## Pinning Versions

Always use specific tags in production instead of `latest`:

```bash
# Good — version pinned
daoflow deploy --service my-app --image my-app:v1.2.3 --yes

# Avoid in production — mutable tag
daoflow deploy --service my-app --image my-app:latest --yes
```

DaoFlow records the exact image digest for each deployment, so you can see precisely which image version was deployed even if tags are overwritten.
