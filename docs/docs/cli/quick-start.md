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
# Browser/device-code login
daoflow login --url https://your-daoflow.example.com --sso

# If the CLI cannot open a browser, it prints the verification URL
# and prompts for the one-time CLI code after you approve the session.

# Or password login
daoflow login --url http://localhost:3000 --email owner@daoflow.local --password secret1234

# Or set env vars directly (for agents and CI; set both together)
export DAOFLOW_TOKEN="dfl_your_token_here"
export DAOFLOW_URL="https://your-daoflow.example.com"
```

## Bootstrap a Fresh Install

```bash
# Let daoflow install seed the first owner into the generated .env
export DAOFLOW_INITIAL_ADMIN_EMAIL="owner@your-daoflow.example.com"
export DAOFLOW_INITIAL_ADMIN_PASSWORD="replace-this-secret"

daoflow install --dir /opt/daoflow --yes
```

## Check Your Identity

```bash
daoflow whoami --json
# → { "ok": true, "data": { "principal": { "email": "..." }, "role": "owner", "authMethod": "api-token" } }

daoflow capabilities --json
# → { "ok": true, "data": { "scopes": ["server:read", "deploy:start", ...] } }
```

## Common Workflows

### Deploy a Service

```bash
# Preview deployment plan (safe, read-only)
daoflow deploy --service svc_my_api --dry-run --json

# Execute deployment
daoflow deploy --service svc_my_api --commit abc1234 --yes --json

# Preview a direct compose upload path
daoflow deploy --compose ./docker-compose.yaml --server srv_vps1 --dry-run
```

### Check Status

```bash
# Server health
daoflow status --json
daoflow doctor --json

# List services
daoflow services --json

# List projects
daoflow projects list --json

# Inspect one project plus its environments
daoflow projects show proj_123 --json

# Create a project
daoflow projects create --name demo --repo-url https://github.com/acme/demo --yes --json

# Create a staging environment override
daoflow projects env create --project proj_123 --name staging --server srv_vps1 --yes --json
```

### View Logs

```bash
# Stream deployment logs
daoflow logs --deployment <id> --json
```

### Rollback

```bash
# List available rollback targets
daoflow rollback --service svc_my_api --json

# Preview rollback plan
daoflow rollback --service svc_my_api --target <deployment-id> --dry-run

# Execute rollback
daoflow rollback --service svc_my_api --target <deployment-id> --yes --json
```

### Compare Deployments

```bash
# Diff two deployments inside your accessible team scope
daoflow diff --a <deployment-id-1> --b <deployment-id-2> --json
```

### Cancel a Deployment

```bash
daoflow cancel --deployment <id> --yes --json
```

### Manage Environment Variables

```bash
# List env vars for an environment
daoflow env list --env-id <id> --json

# Set an env var
daoflow env set --env-id <id> --key DATABASE_URL --value "postgres://..." --yes

# Push from .env file
daoflow env push --file .env --env-id <id>
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

| Code | Meaning           |
| ---- | ----------------- |
| `0`  | Success           |
| `1`  | Error             |
| `2`  | Permission denied |
| `3`  | Dry-run completed |

## Agent Integration

Every command supports `--json` for structured output. AI agents should:

1. Always use `--json` for machine-readable output
2. Use `--dry-run` before destructive operations
3. Check `{ "ok": true/false }` in every response
4. Handle `{ "code": "SCOPE_DENIED", "requiredScope": "..." }` errors
