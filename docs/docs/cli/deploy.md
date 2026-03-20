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
| `--context <path>`        | —        | Upload root for compose-local inputs                    |
| `--image <ref>`           | —        | Docker image reference                                  |
| `--preview-branch <name>` | —        | Target a preview deployment for a compose source branch |
| `--preview-pr <number>`   | —        | Associate the preview with a pull request               |
| `--preview-close`         | —        | Destroy the targeted preview stack instead of deploy    |
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
  --context . \
  --dry-run

# Execute the deployment
daoflow deploy \
  --server production \
  --compose ./compose.yaml \
  --context . \
  --yes
```

For direct compose deploys, `--context` must include every compose-relative local input that needs bundling. DaoFlow validates local `build.context` paths, bundleable `build.additional_contexts`, file-backed build secrets, and local `env_file` assets before prompting or uploading anything. If the chosen root is too narrow, the CLI exits with `INVALID_INPUT`.

### Image Deployment

```bash
daoflow deploy \
  --service my-api \
  --server production \
  --image ghcr.io/myorg/my-api:v1.2.3 \
  --yes
```

### Compose Preview Deployment

```bash
daoflow deploy \
  --service svc_preview \
  --preview-branch feature/login \
  --preview-pr 42 \
  --dry-run

daoflow deploy \
  --service svc_preview \
  --preview-branch feature/login \
  --preview-pr 42 \
  --yes

daoflow deploy \
  --service svc_preview \
  --preview-branch feature/login \
  --preview-pr 42 \
  --preview-close \
  --yes
```

Preview targeting is supported only for registered compose services with `config.preview.enabled`. Direct `--compose` uploads do not support preview flags.

If the backing project also has webhook auto-deploy configured, DaoFlow can queue the same preview deploy and cleanup actions automatically from GitHub pull request or GitLab merge request lifecycle events. Manual `daoflow deploy --service ... --preview-*` remains the explicit fallback for retries and operator-driven cleanup.

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

When using `--dry-run` with `--compose`, the CLI calls the planning-lane `composeDeploymentPlan` route. The CLI still computes local context bundle metadata first so the server-side plan can include upload size, included override files, and local build-context requirements without mutating anything.

```bash
daoflow deploy --compose ./compose.yaml --server prod --dry-run --json
```

```json
{
  "ok": true,
  "data": {
    "dryRun": true,
    "plan": {
      "isReady": true,
      "deploymentSource": "uploaded-context",
      "project": { "id": null, "name": "preview-stack", "action": "create" },
      "environment": { "id": null, "name": "production", "action": "create" },
      "service": {
        "id": null,
        "name": "preview-stack",
        "action": "create",
        "sourceType": "compose"
      },
      "target": {
        "serverId": "srv_prod",
        "serverName": "prod",
        "serverHost": "203.0.113.10",
        "composePath": "./compose.yaml",
        "contextPath": ".",
        "requiresContextUpload": true,
        "localBuildContexts": [
          { "serviceName": "web", "context": ".", "dockerfile": "Dockerfile" }
        ],
        "contextBundle": { "fileCount": 42, "sizeBytes": 13824, "includedOverrides": [".env"] }
      },
      "preflightChecks": [
        { "status": "ok", "detail": "Target server resolved to prod (203.0.113.10)." }
      ],
      "steps": [
        "Freeze the compose file and local build-context manifest",
        "Bundle the local build context while respecting .dockerignore rules",
        "Upload the staged archive and compose file to the DaoFlow control plane"
      ],
      "executeCommand": "daoflow deploy --compose ./compose.yaml --server srv_prod --context . --yes"
    }
  }
}
```

Exit code is `3` for successful dry runs.

## Current Support

- `daoflow deploy --service <id> --yes` deploys an existing DaoFlow service definition.
- `daoflow deploy --compose ./compose.yaml --server <id> --yes` uploads the Compose file directly.
- If the Compose file uses local build inputs such as `build.context`, `build.additional_contexts`, local build secret files, or local `env_file` assets, the CLI bundles the required files, respects `.dockerignore`, uploads them, and the server executes the build remotely.

## Safety

- `--yes` is required for non-interactive execution
- Without `--yes`, the CLI prompts for confirmation
- `--dry-run` always works, even with read-only tokens
- Duplicate deployments are prevented with `--idempotency-key`
