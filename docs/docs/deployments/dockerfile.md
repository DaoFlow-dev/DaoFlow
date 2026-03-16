---
sidebar_position: 3
---

# Dockerfile Deployments

Deploy applications by building from a Dockerfile in a Git repository.

## How It Works

1. DaoFlow clones the Git repository on the target server
2. Builds the Docker image using the specified Dockerfile
3. Starts the container with the configured settings
4. Monitors health and records the outcome

## CLI Deployment

```bash
daoflow deploy \
  --service my-api \
  --server prod \
  --repo https://github.com/org/my-api \
  --dockerfile Dockerfile \
  --yes
```

## Build Process

The build follows these steps:

| Step     | Action                                           |
| -------- | ------------------------------------------------ |
| Clone    | `git clone --depth 1` the repository             |
| Checkout | Check out the specified branch/commit            |
| Build    | `docker build -t <tag> -f Dockerfile .`          |
| Start    | `docker run` with configured ports, env, volumes |
| Health   | Run health checks                                |

## Multi-Stage Builds

DaoFlow supports multi-stage Dockerfiles:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## Commit SHA Tracking

Each deployment records the Git commit SHA, so you can trace exactly which code version is running and roll back to specific commits.
