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
    "serviceName": "my-app",
    "targetServerId": "srv_abc123",
    "sourceType": "compose",
    "composePath": "./compose.yaml"
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
        "steps": [
          { "action": "pull", "detail": "Pull nginx:1.25" },
          { "action": "stop", "detail": "Stop current containers" },
          { "action": "start", "detail": "Start new containers" },
          { "action": "health-check", "detail": "Verify health" }
        ],
        "estimatedDuration": "30s",
        "rollbackAvailable": true,
        "configDiff": {
          "added": ["NEW_ENV_VAR"],
          "removed": [],
          "changed": ["IMAGE_TAG"]
        }
      }
    }
  }
}
```

## rollbackPlan

Preview what a rollback would do.

```
POST /trpc/rollbackPlan
{
  "json": {
    "serviceName": "my-app",
    "targetDeploymentId": "dep_abc123"
  }
}
```

**Scope:** `deploy:read`

## configDiff

Compare current vs desired configuration.

```
POST /trpc/configDiff
{
  "json": {
    "serviceName": "my-app",
    "currentDeploymentId": "dep_current",
    "targetDeploymentId": "dep_previous"
  }
}
```

**Scope:** `deploy:read`
