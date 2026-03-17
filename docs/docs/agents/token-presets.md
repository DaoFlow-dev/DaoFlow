---
sidebar_position: 6
---

# Token Presets for AI Agents

DaoFlow provides **preset token configurations** that give AI agents the exact scopes they need — no more, no less. This is a critical safety feature per [AGENTS.md §11](/docs/concepts/vision).

## Available Presets

| Preset | Scopes | Use Case |
|--------|--------|----------|
| `agent:read-only` | `server:read`, `deploy:read`, `service:read`, `env:read`, `logs:read`, `events:read`, `diagnostics:read`, `backup:read` | Monitoring, diagnosis, log analysis |
| `agent:minimal-write` | All read scopes + `deploy:start`, `deploy:cancel`, `env:write` | CI/CD deploy pipelines |
| `agent:full` | All scopes including `deploy:rollback`, `backup:run`, `backup:restore`, `volumes:write` | Full autonomous operation |

## Creating Preset Tokens

### Via CLI

```bash
# List available presets
daoflow token presets --json

# Create a read-only agent token
daoflow token create --name "monitor-bot" --preset agent:read-only --yes

# Create a deploy agent token
daoflow token create --name "deploy-bot" --preset agent:minimal-write --yes

# Create a full-access agent token
daoflow token create --name "ops-bot" --preset agent:full --yes
```

### Via API

```bash
# Create agent principal + token with preset
curl -X POST https://your-daoflow.com/api/trpc/createAgent \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "deploy-agent", "preset": "agent:minimal-write"}'
```

## Managing Tokens

```bash
# List all tokens
daoflow token list --json

# Revoke a token
daoflow token revoke --id <token-id> --yes
```

## Safety Design

1. **Agents default to read-only** — `agent:read-only` is the recommended starting preset
2. **No self-elevation** — an agent cannot grant itself more scopes
3. **Structured denials** — when a scope is denied, the error includes `{ requiredScopes: [...] }`
4. **Audit trail** — every token creation and revocation is recorded

## Example: AI Coding Agent Workflow

```bash
# 1. Agent authenticates
export DAOFLOW_TOKEN="dfl_abc123..."

# 2. Agent reads current state
daoflow status --json
daoflow services --json

# 3. Agent creates a deploy plan (read-only)
daoflow plan --service my-api --json

# 4. Agent deploys (requires agent:minimal-write)
daoflow deploy --service my-api --commit abc1234 --yes --json
```

## Best Practices

- Start with `agent:read-only` and upgrade only when needed
- Use separate tokens per agent or pipeline
- Set TTL expirations: `--expires-in-days 30`
- Regularly audit with `daoflow token list --json`
