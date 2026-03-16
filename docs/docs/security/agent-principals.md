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

## Agent Safety Model

| Principle             | Implementation                             |
| --------------------- | ------------------------------------------ |
| Read-only by default  | `agent` role has no write scopes           |
| Explicit write grants | Write scopes added per-token               |
| No self-elevation     | Agents cannot modify their own permissions |
| Audit trail           | Every action logged with agent identity    |
| Structured errors     | Permission denials include required scopes |
| `--yes` required      | CLI commands require explicit confirmation |
| `--dry-run` available | Agents can preview before executing        |

## Best Practices

- Create one agent principal per AI tool (Cursor, Copilot, custom)
- Use separate tokens for read vs write operations
- Review audit logs periodically for agent activity
- Set token expiry to limit blast radius
