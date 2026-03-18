---
sidebar_position: 8
---

# daoflow plan

Generate a deployment plan without executing it. This is the primary planning command for AI agents.

## Usage

```bash
daoflow plan [options]
```

## Options

| Flag               | Description                    |
| ------------------ | ------------------------------ |
| `--service <name>` | Service to plan for (required) |
| `--server <name>`  | Target server                  |
| `--image <ref>`    | Docker image to plan with      |
| `--json`           | Structured JSON output         |

## Required Scope

`deploy:read`

## Examples

```bash
daoflow plan --service svc_123 --server prod --image ghcr.io/acme/api:1.4.2 --json
```

## JSON Output

```json
{
  "ok": true,
  "data": {
    "isReady": true,
    "service": {
      "id": "svc_123",
      "name": "api",
      "sourceType": "compose",
      "projectId": "proj_123",
      "projectName": "Acme",
      "environmentId": "env_123",
      "environmentName": "production",
      "imageReference": "ghcr.io/acme/api:stable",
      "dockerfilePath": null,
      "composeServiceName": "api",
      "healthcheckPath": "/healthz"
    },
    "target": {
      "serverId": "srv_123",
      "serverName": "prod",
      "serverHost": "10.0.0.42",
      "imageTag": "ghcr.io/acme/api:1.4.2"
    },
    "currentDeployment": {
      "id": "dep_123",
      "status": "running",
      "statusLabel": "Running",
      "statusTone": "running",
      "imageTag": "ghcr.io/acme/api:1.4.1",
      "commitSha": "abcdef1",
      "createdAt": "2026-03-17T20:00:00.000Z",
      "finishedAt": null
    },
    "preflightChecks": [
      { "status": "ok", "detail": "Service api is registered in production." },
      { "status": "ok", "detail": "Target server resolved to prod (10.0.0.42)." },
      { "status": "ok", "detail": "Source type is compose." },
      { "status": "ok", "detail": "Deployment input will use ghcr.io/acme/api:1.4.2." }
    ],
    "steps": [
      "Freeze the compose inputs and resolved runtime spec",
      "Pull ghcr.io/acme/api:1.4.2 and refresh compose services",
      "Apply docker compose up -d with the staged configuration",
      "Run configured health check and promote only if it stays green",
      "Dispatch execution to prod"
    ],
    "executeCommand": "daoflow deploy --service svc_123 --server srv_123 --image ghcr.io/acme/api:1.4.2 --yes"
  }
}
```

## Agent Usage

The `plan` command is safe for AI agents — it only reads state and generates plans without executing anything. Use it before `deploy --yes` to preview changes.
