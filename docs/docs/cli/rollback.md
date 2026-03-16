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

| Flag | Description |
|------|-------------|
| `--service <name>` | Service to rollback (required) |
| `--to <deployment_id>` | Target deployment ID (default: previous successful) |
| `--dry-run` | Preview rollback plan without executing |
| `--yes` | Skip confirmation |
| `--json` | Structured JSON output |

## Required Scope

`deploy:rollback`

## Examples

```bash
# Rollback to the previous successful deployment
daoflow rollback --service my-app --yes

# Rollback to a specific deployment
daoflow rollback --service my-app --to dep_abc123 --yes

# Preview rollback
daoflow rollback --service my-app --dry-run --json
```

## JSON Output

```json
{
  "ok": true,
  "rollbackDeploymentId": "dep_xyz789",
  "targetDeploymentId": "dep_abc123",
  "service": "my-app",
  "status": "queued"
}
```
