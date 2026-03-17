---
sidebar_position: 2
---

# CLI Quick Start

Get up and running with the DaoFlow CLI in under 5 minutes. Designed for both humans and AI agents.

## Install

```bash
# One-line install
curl -fsSL -o /usr/local/bin/daoflow \
  https://github.com/DaoFlow-dev/DaoFlow/releases/latest/download/daoflow-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
chmod +x /usr/local/bin/daoflow

# Or build from source
cd packages/cli && bun run build && bun link
```

## Authenticate

```bash
# Interactive login
daoflow login

# Or set token directly (for agents)
export DAOFLOW_TOKEN="dfl_your_token_here"
export DAOFLOW_URL="https://your-daoflow.example.com"
```

## Check Your Identity

```bash
daoflow whoami --json
# → { "ok": true, "user": { "email": "...", "role": "owner" } }

daoflow capabilities --json
# → { "ok": true, "scopes": ["server:read", "deploy:start", ...] }
```

## Common Workflows

### Deploy a Service

```bash
# Preview deployment plan (safe, read-only)
daoflow deploy --service my-api --dry-run --json

# Execute deployment
daoflow deploy --service my-api --commit abc1234 --yes --json

# Deploy with compose
daoflow deploy --compose ./docker-compose.yaml --server vps1 --yes
```

### Check Status

```bash
# Server health
daoflow status --json
daoflow doctor --json

# List services
daoflow services --json

# List projects
daoflow projects --json
```

### View Logs

```bash
# Stream deployment logs
daoflow logs --deployment <id> --json
```

### Rollback

```bash
# List available rollback targets
daoflow rollback --service my-api --json

# Preview rollback plan
daoflow rollback --service my-api --target <deployment-id> --dry-run

# Execute rollback
daoflow rollback --service my-api --target <deployment-id> --yes --json
```

### Compare Deployments

```bash
# Diff two deployments
daoflow diff --a <deployment-id-1> --b <deployment-id-2> --json
```

### Cancel a Deployment

```bash
daoflow cancel --deployment <id> --yes --json
```

### Manage Environment Variables

```bash
# List env vars for an environment
daoflow env list --environment <id> --json

# Set an env var
daoflow env set --environment <id> --key DATABASE_URL --value "postgres://..." --yes

# Push from .env file
daoflow env push --file .env --environment <id>
```

### Manage Tokens

```bash
# List presets
daoflow token presets --json

# Create agent token
daoflow token create --name "ci-bot" --preset agent:minimal-write --yes

# List tokens
daoflow token list --json

# Revoke
daoflow token revoke --id <token-id> --yes
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error |
| `2` | Permission denied |
| `3` | Dry-run completed |

## Agent Integration

Every command supports `--json` for structured output. AI agents should:

1. Always use `--json` for machine-readable output
2. Use `--dry-run` before destructive operations
3. Check `{ "ok": true/false }` in every response
4. Handle `{ "code": "SCOPE_DENIED", "requiredScope": "..." }` errors
