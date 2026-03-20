---
sidebar_position: 5
---

# daoflow rollback

Roll back a service to a previous deployment.

## Usage

```bash
daoflow rollback [options]
```

## Options

| Flag                       | Description                                         |
| -------------------------- | --------------------------------------------------- |
| `--service <id>`           | Service ID to rollback (required)                   |
| `--target <deployment_id>` | Target deployment ID (default: previous successful) |
| `--to <deployment_id>`     | Alias for `--target`                                |
| `--dry-run`                | Preview rollback plan without executing             |
| `--yes`                    | Skip confirmation                                   |
| `--json`                   | Structured JSON output                              |

## Required Scope

- `deploy:read` for `--dry-run`
- `deploy:rollback` for execution

## Examples

```bash
# Rollback to the previous successful deployment
daoflow rollback --service svc_my_app --yes

# Rollback to a specific deployment
daoflow rollback --service svc_my_app --target dep_abc123 --yes

# Preview rollback
daoflow rollback --service svc_my_app --to dep_abc123 --dry-run --json
```

## JSON Output

```json
{
  "ok": true,
  "data": {
    "dryRun": true,
    "plan": {
      "isReady": true,
      "service": {
        "id": "svc_abc123",
        "name": "api",
        "projectName": "Acme",
        "environmentName": "production"
      },
      "currentDeployment": {
        "id": "dep_current123",
        "status": "failed",
        "statusLabel": "Failed"
      },
      "targetDeployment": {
        "id": "dep_abc123",
        "imageTag": "ghcr.io/acme/api:1.4.1",
        "commitSha": "abcdef1",
        "concludedAt": "2026-03-17T19:00:00.000Z"
      },
      "availableTargets": [
        {
          "deploymentId": "dep_abc123",
          "serviceName": "api",
          "sourceType": "compose",
          "commitSha": "abcdef1",
          "imageTag": "ghcr.io/acme/api:1.4.1",
          "concludedAt": "2026-03-17T19:00:00.000Z",
          "status": "available"
        }
      ],
      "preflightChecks": [
        {
          "status": "ok",
          "detail": "Found 1 successful rollback target within retention."
        }
      ],
      "steps": [
        "Freeze the current deployment state for api",
        "Rehydrate runtime inputs from deployment dep_abc123",
        "Queue a new rollback deployment record with the preserved configuration"
      ],
      "executeCommand": "daoflow rollback --service svc_abc123 --target dep_abc123 --yes"
    }
  }
}
```
