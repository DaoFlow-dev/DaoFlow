---
sidebar_position: 5
---

# Agent Principals

Agent principals are dedicated identities for AI coding agents. They provide constrained, auditable access to DaoFlow.

## Why Agent Principals?

AI agents need:

- Their own identity (not a shared user account)
- Read-only defaults (safety first)
- Explicit scope grants for write operations
- Audit trail of every action taken
- Rate limits to prevent runaway loops

## Creating an Agent Principal

### Via Dashboard

1. Go to **Settings → Users**
2. Click **Add Principal**
3. Select type: **Agent**
4. Enter a name (e.g., "cursor-agent", "github-copilot")
5. A read-only API token is generated automatically

### Default Permissions

Agent principals get the `agent` role, which includes only read scopes:

- `server:read`, `deploy:read`, `service:read`
- `logs:read`, `events:read`, `diagnostics:read`

### Granting Write Access

To allow an agent to deploy:

1. Create an API token for the agent principal
2. Add specific write scopes: `deploy:start`, `env:write`
3. The agent can now deploy within those scopes

## Token Presets

Instead of manually selecting individual scopes, DaoFlow provides **three presets** that cover common agent use cases:

| Preset                | Label               | Lanes                   | Use Case                                   |
| --------------------- | ------------------- | ----------------------- | ------------------------------------------ |
| `agent:read-only`     | Read-Only Agent     | read                    | Monitoring, observability, diagnostics     |
| `agent:minimal-write` | Minimal Write Agent | read, planning, command | CI/CD pipelines, limited deploys           |
| `agent:full`          | Full Agent          | read, planning, command | Trusted agent with full operational access |

### `agent:read-only`

Observe everything, mutate nothing. Ideal for monitoring dashboards or diagnostic agents.

**Scopes:** `server:read`, `deploy:read`, `service:read`, `env:read`, `volumes:read`, `backup:read`, `logs:read`, `events:read`, `diagnostics:read`

### `agent:minimal-write`

Everything in read-only, plus the ability to deploy, rollback, and manage environment variables and secrets. Cannot modify servers, volumes, or backup policies.

**Added scopes:** `deploy:start`, `deploy:rollback`, `env:write`, `secrets:write`, `approvals:create`

### `agent:full`

All operational scopes for a trusted agent. Still excludes dangerous administrative scopes.

**Added scopes:** `server:write`, `deploy:cancel`, `service:update`, `secrets:read`, `volumes:write`, `backup:run`, `backup:restore`, `approvals:decide`

**Never granted:** `terminal:open`, `policy:override`, `members:manage`, `tokens:manage`

### Using Presets via CLI

```bash
# Create an agent token with a preset
daoflow token create --name "ci-agent" --preset agent:minimal-write --json

# List available presets
daoflow token presets --json
```

### Using Presets Programmatically

```typescript
import { getAgentTokenPresetScopes, listAgentTokenPresets } from "@daoflow/shared";

// Get scopes for a preset
const scopes = getAgentTokenPresetScopes("agent:read-only");
// → ["server:read", "deploy:read", "service:read", ...]

// List all presets with metadata
const presets = listAgentTokenPresets();
// → [{ name: "agent:read-only", label: "Read-Only Agent", ... }, ...]
```

## Agent Safety Model

| Principle             | Implementation                                        |
| --------------------- | ----------------------------------------------------- |
| Read-only by default  | `agent` role has no write scopes                      |
| Explicit write grants | Write scopes added per-token                          |
| Preset boundaries     | No preset grants `terminal:open` or `policy:override` |
| No self-elevation     | Agents cannot modify their own permissions            |
| Audit trail           | Every action logged with agent identity               |
| Structured errors     | Permission denials include required scopes            |
| `--yes` required      | CLI commands require explicit confirmation            |
| `--dry-run` available | Agents can preview before executing                   |

## Best Practices

- **Start with `agent:read-only`** — grant write access only when needed
- Create one agent principal per AI tool (Cursor, Copilot, custom)
- Use `agent:minimal-write` for CI/CD pipelines
- Reserve `agent:full` for trusted autonomous agents
- Review audit logs periodically for agent activity
- Set token expiry to limit blast radius
