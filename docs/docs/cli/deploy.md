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

When using `--dry-run`, the CLI outputs the deployment plan without executing it:

```bash
daoflow deploy --service my-app --server prod --compose ./compose.yaml --dry-run --json
```

```json
{
  "ok": true,
  "dryRun": true,
  "plan": {
    "service": "my-app",
    "server": "prod",
    "sourceType": "compose",
    "steps": ["pull", "create-volume", "start", "health-check"]
  }
}
```

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
