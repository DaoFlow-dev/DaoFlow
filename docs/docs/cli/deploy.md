---
sidebar_position: 3
---

# daoflow deploy

Deploy a service to a target server. This is the primary command for shipping code.

## Usage

```bash
daoflow deploy [options]
```

## Options

| Flag                      | Required | Description                                             |
| ------------------------- | -------- | ------------------------------------------------------- |
| `--service <name>`        | Yes      | Service name                                            |
| `--server <name>`         | Yes      | Target server                                           |
| `--compose <path>`        | —        | Path to compose.yaml for direct Compose deployment      |
| `--image <ref>`           | —        | Docker image reference                                  |
| `--env <key=value>`       | —        | Set environment variables (repeatable)                  |
| `--dry-run`               | —        | Preview plan without executing (exit code 3)            |
| `--yes`                   | —        | Skip confirmation prompt (required for non-interactive) |
| `--idempotency-key <key>` | —        | Prevent duplicate deployments                           |
| `--json`                  | —        | Structured JSON output                                  |

## Required Scope

`deploy:start`

## Examples

### Docker Compose Preview

```bash
# Preview the deployment plan
daoflow deploy \
  --server production \
  --compose ./compose.yaml \
  --dry-run

# Execute the deployment
daoflow deploy \
  --server production \
  --compose ./compose.yaml \
  --yes
```

### Image Deployment

```bash
daoflow deploy \
  --service my-api \
  --server production \
  --image ghcr.io/myorg/my-api:v1.2.3 \
  --yes
```

### With Environment Variables

```bash
daoflow deploy \
  --service my-app \
  --server production \
  --image my-app:latest \
  --env DATABASE_URL=postgresql://... \
  --env REDIS_URL=redis://... \
  --yes
```

## JSON Output

```json
{
  "ok": true,
  "deploymentId": "dep_abc123",
  "status": "queued",
  "service": "my-app",
  "server": "production",
  "sourceType": "compose",
  "createdAt": "2026-03-15T10:30:00Z"
}
```

## Dry Run

When using `--dry-run` with `--service`, the CLI calls the real planning-lane deployment planner and returns that server-side preview without executing anything:

```bash
daoflow deploy --service my-app --server prod --dry-run --json
```

```json
{
  "ok": true,
  "data": {
    "dryRun": true,
    "plan": {
      "isReady": true,
      "service": {
        "name": "my-app",
        "projectName": "Acme",
        "environmentName": "production"
      },
      "target": {
        "serverName": "prod",
        "imageTag": "ghcr.io/acme/my-app:stable"
      },
      "currentDeployment": null,
      "preflightChecks": [{ "status": "ok", "detail": "Resolved target server." }],
      "steps": ["Freeze runtime spec", "Dispatch execution"],
      "executeCommand": "daoflow deploy --service svc_123 --server prod --yes"
    }
  }
}
```

When using `--dry-run` with `--compose`, the CLI still performs a local preview of context bundling and upload steps because there is not yet a dedicated server-side compose planning route.

Exit code is `3` for successful dry runs.

## Current Support

- `daoflow deploy --service <id> --yes` deploys an existing DaoFlow service definition.
- `daoflow deploy --compose ./compose.yaml --server <id> --yes` uploads the Compose file directly.
- If the Compose file uses local `build.context` paths, the CLI bundles the context, respects `.dockerignore`, uploads it, and the server executes the build remotely.

## Safety

- `--yes` is required for non-interactive execution
- Without `--yes`, the CLI prompts for confirmation
- `--dry-run` always works, even with read-only tokens
- Duplicate deployments are prevented with `--idempotency-key`
