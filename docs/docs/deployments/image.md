---
sidebar_position: 4
---

# Image Deployments

Deploy pre-built Docker images directly — the simplest deployment method.

## CLI Deployment

```bash
daoflow deploy \
  --service svc_my_app \
  --server srv_prod \
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

| Registry                  | Example                                         |
| ------------------------- | ----------------------------------------------- |
| Docker Hub                | `nginx:alpine`                                  |
| GitHub Container Registry | `ghcr.io/org/app:latest`                        |
| AWS ECR                   | `123456.dkr.ecr.us-east-1.amazonaws.com/app:v1` |
| Google Artifact Registry  | `us-docker.pkg.dev/project/repo/app:v1`         |
| Self-hosted               | `registry.example.com/app:v1`                   |

## Registry Credentials And Teams

Saved registry credentials belong to the active team. A deployment only receives credentials from
its project's team, and only for registry hosts referenced by the image being pulled. Build steps
can use that same project's saved registry credentials; credentials from another team are never
listed or passed to a deployment.

The same registry host or display name can be configured independently by different teams.

## Pinning Versions

Always use specific tags in production instead of `latest`:

```bash
# Good — version pinned
daoflow deploy --service svc_my_app --image my-app:v1.2.3 --yes

# Avoid in production — mutable tag
daoflow deploy --service svc_my_app --image my-app:latest --yes
```

DaoFlow records the exact image digest for each deployment, so you can see precisely which image version was deployed even if tags are overwritten.
