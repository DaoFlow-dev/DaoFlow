---
sidebar_position: 4
---

# Planning Endpoints

Planning endpoints generate previews of changes without executing them. They are safe for AI agents to call freely.

## deploymentPlan

Generate a deployment plan without executing it.

```
POST /trpc/deploymentPlan
{
  "json": {
    "service": "svc_abc123",
    "server": "srv_abc123",
    "image": "ghcr.io/acme/api:1.4.2"
  }
}
```

**Scope:** `deploy:read`

**Response:**

```json
{
  "result": {
    "data": {
      "json": {
        "isReady": true,
        "service": {
          "id": "svc_abc123",
          "name": "api",
          "sourceType": "compose",
          "projectId": "proj_abc123",
          "projectName": "Acme",
          "environmentId": "env_abc123",
          "environmentName": "production",
          "imageReference": "ghcr.io/acme/api:stable",
          "dockerfilePath": null,
          "composeServiceName": "api",
          "healthcheckPath": "/healthz"
        },
        "target": {
          "serverId": "srv_abc123",
          "serverName": "prod-us-west",
          "serverHost": "10.0.0.42",
          "imageTag": "ghcr.io/acme/api:1.4.2"
        },
        "currentDeployment": {
          "id": "dep_abc123",
          "status": "running",
          "statusLabel": "Running",
          "statusTone": "running",
          "imageTag": "ghcr.io/acme/api:1.4.1",
          "commitSha": "abcdef1",
          "createdAt": "2026-03-17T20:00:00.000Z",
          "finishedAt": null
        },
        "preflightChecks": [
          {
            "status": "ok",
            "detail": "Service api is registered in production."
          },
          {
            "status": "ok",
            "detail": "Target server resolved to prod-us-west (10.0.0.42)."
          }
        ],
        "steps": [
          "Freeze the compose inputs and resolved runtime spec",
          "Pull ghcr.io/acme/api:1.4.2 and refresh compose services",
          "Apply docker compose up -d with the staged configuration",
          "Run configured health check and promote only if it stays green",
          "Dispatch execution to prod-us-west"
        ],
        "executeCommand": "daoflow deploy --service svc_abc123 --server srv_abc123 --image ghcr.io/acme/api:1.4.2 --yes"
      }
    }
  }
}
```

The current planning surface returns a deterministic preview from registered service, environment, server, and deployment records. It does not execute anything.

## Future Planning Surfaces

Additional planning endpoints such as rollback previews and config diffs are intended follow-up work. Do not assume they exist until they are documented alongside a shipped route.
