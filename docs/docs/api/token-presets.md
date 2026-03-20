---
sidebar_position: 6
---

# Token & Preset API Endpoints

These tRPC endpoints manage agent tokens and preset configurations.

The authoritative generated contract artifact is [`api-contract.json`](/contracts/api-contract.json).

## Read Endpoints

### `agentTokenInventory`

List all agent tokens with summary statistics.

**Required role**: `owner` or `admin`

```json
// Response
{
  "summary": {
    "totalTokens": 3,
    "readOnlyTokens": 1,
    "commandTokens": 2
  },
  "tokens": [
    {
      "id": "tok_abc",
      "name": "deploy-bot",
      "principalKind": "agent",
      "lanes": ["read", "command"],
      "status": "active",
      "createdAt": "2026-03-17T00:00:00.000Z"
    }
  ]
}
```

### `principalInventory`

List all principals (users, agents, service accounts).

**Required role**: `owner` or `admin`

```json
// Response
{
  "principals": [
    {
      "id": "prin_abc",
      "name": "deploy-agent",
      "type": "agent",
      "status": "active",
      "createdAt": "2026-03-17T00:00:00.000Z"
    }
  ]
}
```

## Command Endpoints

### `createAgent`

Create a new agent principal with preset or custom scopes.

**Required role**: `owner` or `admin`

```json
// Input — with preset
{ "name": "deploy-bot", "preset": "agent:minimal-write" }

// Input — with custom scopes
{ "name": "monitor-bot", "scopes": ["server:read", "deploy:read", "logs:read"] }

// Response
{ "id": "prin_abc", "name": "deploy-bot", "type": "agent", "status": "active" }
```

:::warning
You must provide either `preset` or `scopes`, not both.
:::

### `generateAgentToken`

Generate an API token for an existing agent principal.

**Scope**: `tokens:manage`

```json
// Input
{
  "principalId": "prin_abc",
  "tokenName": "production-token",
  "expiresInDays": 90
}

// Response
{ "token": { "id": "tok_abc", "name": "production-token" }, "tokenValue": "dfl_live_abc123..." }
```

:::caution
The `tokenValue` is only returned once. Store it securely.
:::

### `revokeAgentToken`

Revoke an active agent token.

**Scope**: `tokens:manage`

```json
// Input
{ "tokenId": "tok_abc" }

// Response
{ "revoked": true }
```

## Preset Definitions

| Preset                | Read Scopes                                                                                                             | Write Scopes                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `agent:read-only`     | `server:read`, `deploy:read`, `service:read`, `env:read`, `logs:read`, `events:read`, `diagnostics:read`, `backup:read` | —                                                                                                   |
| `agent:minimal-write` | All read scopes                                                                                                         | `deploy:start`, `deploy:cancel`, `deploy:rollback`, `env:write`, `secrets:read`, `approvals:create` |
| `agent:full`          | All read scopes                                                                                                         | All write scopes including `deploy:rollback`, `backup:run`, `backup:restore`, `volumes:write`       |

## Error Responses

```json
// Permission denied
{
  "ok": false,
  "error": "Insufficient permissions",
  "code": "SCOPE_DENIED",
  "requiredScope": "tokens:manage"
}

// Not found
{
  "ok": false,
  "error": "Agent not found.",
  "code": "NOT_FOUND"
}

// Conflict
{
  "ok": false,
  "error": "Provide either scopes or preset, not both",
  "code": "BAD_REQUEST"
}
```
