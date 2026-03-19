---
sidebar_position: 5
---

# Command Endpoints

Command endpoints mutate infrastructure. Every call creates an audit record.

## createDeploymentRecord

Start a new deployment.

```
POST /trpc/createDeploymentRecord
{
  "json": {
    "serviceName": "my-app",
    "projectId": "proj_abc123",
    "environmentId": "env_prod",
    "targetServerId": "srv_123",
    "sourceType": "compose",
    "imageTag": "nginx:1.25",
    "configSnapshot": {}
  }
}
```

**Scope:** `deploy:start`

**Headers:**

```
X-Idempotency-Key: unique-deploy-key-123
```

## reconcileComposePreviews

Evaluate preview routing drift and queue destroy deployments for stale preview stacks.

```
POST /trpc/reconcileComposePreviews
{
  "json": {
    "serviceId": "svc_preview",
    "dryRun": false,
    "limit": 20
  }
}
```

**Scope:** `deploy:start`

**Response includes:**

- `summary` — reconciliation counts for the targeted service
- `previews[]` — the same reconciliation report returned by `composePreviewReconciliation`
- `execution.gcQueued` — how many stale preview cleanup deployments were queued
- `execution.queuedDeployments[]` — preview keys and deployment IDs for queued cleanup actions

## registerServer

Register a new managed server.

```
POST /trpc/registerServer
{
  "json": {
    "name": "production-vps",
    "host": "203.0.113.10",
    "port": 22,
    "sshKeyPath": "~/.ssh/id_ed25519"
  }
}
```

**Scope:** `server:write`

## createProject

Create a new project.

```
POST /trpc/createProject
{
  "json": {
    "name": "my-web-app",
    "description": "Production web application",
    "repoUrl": "https://github.com/org/app",
    "teamId": "default"
  }
}
```

**Scope:** `service:update`

## updateApprovalRequest

Approve or reject a gated action.

```
POST /trpc/updateApprovalRequest
{
  "json": {
    "id": "apr_abc123",
    "action": "approve"
  }
}
```

**Scope:** `approvals:decide`

## Idempotency

All command endpoints accept an `X-Idempotency-Key` header. If a request with the same key has already been processed, the original response is returned without re-executing the operation.

## Dry Run

Command endpoints that support dry-run accept a `dryRun: true` parameter in the request body. Dry-run calls return the plan without executing it.
