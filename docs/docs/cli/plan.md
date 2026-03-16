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
| `--compose <path>` | Path to compose.yaml           |
| `--image <ref>`    | Docker image to plan with      |
| `--json`           | Structured JSON output         |

## Required Scope

`deploy:read`

## Examples

```bash
daoflow plan --service my-app --server prod --compose ./compose.yaml --json
```

## JSON Output

```json
{
  "ok": true,
  "plan": {
    "service": "my-app",
    "server": "prod",
    "sourceType": "compose",
    "currentVersion": "nginx:1.24",
    "targetVersion": "nginx:1.25",
    "steps": [
      { "action": "pull", "detail": "Pull nginx:1.25" },
      { "action": "stop", "detail": "Stop current containers" },
      { "action": "start", "detail": "Start new containers" },
      { "action": "health-check", "detail": "Verify service health" }
    ],
    "estimatedDuration": "30s",
    "rollbackAvailable": true
  }
}
```

## Agent Usage

The `plan` command is safe for AI agents — it only reads state and generates plans without executing anything. Use it before `deploy --yes` to preview changes.
