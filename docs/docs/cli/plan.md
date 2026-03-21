---
sidebar_position: 8
---

# daoflow plan

Generate a deployment plan without executing it. This is the primary planning command for AI agents.

For compose-backed plans, DaoFlow now surfaces env precedence, masked provenance, unresolved Compose interpolation, and checked-out `build:` execution requirements before `deploy --yes`.

## Usage

```bash
daoflow plan [options]
```

## Options

| Flag                      | Description                                  |
| ------------------------- | -------------------------------------------- |
| `--service <id>`          | Registered service ID to plan for            |
| `--compose <path>`        | Compose file to plan directly                |
| `--context <path>`        | Upload root for compose-local inputs         |
| `--server <id>`           | Target server ID                             |
| `--image <ref>`           | Docker image to plan with                    |
| `--preview-branch <name>` | Preview source branch for compose services   |
| `--preview-pr <number>`   | Preview pull request number                  |
| `--preview-close`         | Plan preview stack cleanup instead of deploy |
| `--json`                  | Structured JSON output                       |

Provide either `--service` or `--compose`.

For direct compose plans, `--context` must include every compose-relative local input that DaoFlow needs to upload. That includes local `build.context` paths, bundleable `build.additional_contexts`, file-backed build secrets, and local `env_file` assets. If the root is too narrow, the CLI now fails locally with `INVALID_INPUT` instead of sending a misleading plan request.

## Required Scope

`deploy:read`

## Examples

```bash
daoflow plan --service svc_123 --server srv_prod --image ghcr.io/acme/api:1.4.2 --json
```

```bash
daoflow plan --service svc_123 --preview-branch feature/login --preview-pr 42 --json
```

```bash
daoflow plan --compose ./compose.yaml --context . --server srv_prod --json
```

## JSON Output

Service plan:

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
      "healthcheckPath": "/healthz",
      "readinessProbe": {
        "type": "http",
        "target": "published-port",
        "host": "127.0.0.1",
        "scheme": "http",
        "port": 8080,
        "path": "/ready",
        "timeoutSeconds": 60,
        "intervalSeconds": 3,
        "successStatusCodes": [200, 204]
      }
    },
    "composeEnvPlan": {
      "branch": "main",
      "matchedBranchOverrideCount": 1,
      "composeEnv": {
        "precedence": ["repo-defaults", "environment-variables"],
        "counts": {
          "total": 3,
          "repoDefaults": 1,
          "environmentVariables": 2,
          "runtime": 1,
          "build": 1,
          "secrets": 1,
          "overriddenRepoDefaults": 1
        },
        "warnings": [],
        "entries": [
          {
            "key": "DATABASE_URL",
            "displayValue": "[secret]",
            "category": "runtime",
            "isSecret": true,
            "source": "inline",
            "branchPattern": "main",
            "origin": "environment-variable",
            "overrodeRepoDefault": false
          }
        ]
      },
      "interpolation": {
        "status": "warn",
        "summary": {
          "totalReferences": 4,
          "unresolved": 1,
          "requiredMissing": 0,
          "optionalMissing": 1
        },
        "warnings": [],
        "unresolved": [
          {
            "key": "OPTIONAL_VALUE",
            "expression": "$OPTIONAL_VALUE",
            "severity": "warn",
            "detail": "Compose interpolation $OPTIONAL_VALUE is unresolved for branch main; Docker Compose will substitute a blank string."
          }
        ]
      }
    },
    "target": {
      "serverId": "srv_123",
      "serverName": "prod",
      "serverHost": "10.0.0.42",
      "targetKind": "docker-swarm-manager",
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
      { "status": "ok", "detail": "Deployment input will use ghcr.io/acme/api:1.4.2." },
      {
        "status": "ok",
        "detail": "Compose execution will run HTTP readiness on http://127.0.0.1:8080/ready expecting 200, 204 within 60s (poll every 3s) after Docker Compose container state and Docker health are green."
      }
    ],
    "steps": [
      "Freeze the compose inputs and resolved runtime spec",
      "Pull ghcr.io/acme/api:1.4.2 and refresh compose service api",
      "Apply docker compose up -d api with the staged configuration",
      "Verify Docker Compose container state, Docker health, and HTTP readiness on http://127.0.0.1:8080/ready expecting 200, 204 within 60s (poll every 3s), then mark the rollout outcome",
      "Dispatch execution to prod"
    ],
    "executeCommand": "daoflow deploy --service svc_123 --server srv_123 --image ghcr.io/acme/api:1.4.2 --yes"
  }
}
```

For compose-backed services, `healthcheckPath` remains legacy metadata. When `service.config.readinessProbe` is present, the plan shows the real execution contract that DaoFlow will enforce on the target host, including `published-port` or `internal-network` targets and either HTTP or TCP transport.

For git-backed Compose services, the plan also reflects when DaoFlow will build local Compose contexts before start. When the checked-out repository contains `build:` services, expect an extra preflight check describing the detected build services and a corresponding build step ahead of `docker compose up`.

For preview-enabled compose services, `daoflow plan --service` can also model preview deploys and preview cleanup. The returned plan includes preview metadata under `target.preview`, uses the preview env branch when resolving environment variables, and appends `--preview-close` to `executeCommand` when the planned action is cleanup.

Compose plan:

```json
{
  "ok": true,
  "data": {
    "isReady": true,
    "deploymentSource": "uploaded-context",
    "project": {
      "id": null,
      "name": "preview-stack",
      "action": "create"
    },
    "environment": {
      "id": null,
      "name": "production",
      "action": "create"
    },
    "service": {
      "id": null,
      "name": "preview-stack",
      "action": "create",
      "sourceType": "compose"
    },
    "composeEnvPlan": {
      "branch": "main",
      "matchedBranchOverrideCount": 0,
      "composeEnv": {
        "precedence": ["repo-defaults", "environment-variables"],
        "counts": {
          "total": 1,
          "repoDefaults": 1,
          "environmentVariables": 0,
          "runtime": 0,
          "build": 0,
          "secrets": 0,
          "overriddenRepoDefaults": 0
        },
        "warnings": [],
        "entries": [
          {
            "key": "IMAGE_TAG",
            "displayValue": "[repo-default]",
            "category": "default",
            "isSecret": false,
            "source": "repo-default",
            "branchPattern": null,
            "origin": "repo-default",
            "overrodeRepoDefault": false
          }
        ]
      },
      "interpolation": {
        "status": "ok",
        "summary": {
          "totalReferences": 1,
          "unresolved": 0,
          "requiredMissing": 0,
          "optionalMissing": 0
        },
        "warnings": [],
        "unresolved": []
      }
    },
    "target": {
      "serverId": "srv_prod",
      "serverName": "prod",
      "serverHost": "203.0.113.10",
      "targetKind": "docker-swarm-manager",
      "composePath": "./compose.yaml",
      "contextPath": ".",
      "requiresContextUpload": true,
      "localBuildContexts": [{ "serviceName": "web", "context": ".", "dockerfile": "Dockerfile" }],
      "contextBundle": {
        "fileCount": 42,
        "sizeBytes": 13824,
        "includedOverrides": [".env"]
      }
    },
    "preflightChecks": [
      {
        "status": "ok",
        "detail": "Target server resolved to prod (203.0.113.10)."
      }
    ],
    "steps": [
      "Freeze the compose file and local build-context manifest",
      "Bundle the local build context while respecting .dockerignore rules",
      "Upload the staged archive and compose file to the DaoFlow control plane"
    ],
    "executeCommand": "daoflow deploy --compose ./compose.yaml --server srv_prod --context . --yes"
  }
}
```

When `target.targetKind` is `docker-swarm-manager`, the human preview output also prints
`Docker Swarm stack workflow` before the planned steps so operators can distinguish stack execution
from a normal Docker Compose host rollout at a glance.

## Agent Usage

The `plan` command is safe for AI agents. For service plans it previews a registered service rollout; for compose plans it inspects local bundle metadata and adjacent repo-default `.env` content first, then asks the control plane for a non-mutating direct-deploy preview. When the compose spec contains `build:` services, the returned compose plan includes an explicit staged build step before `docker compose up -d`, and it warns if local build inputs still need upload. Use it before `deploy --yes` to preview changes and catch missing interpolation inputs early.
