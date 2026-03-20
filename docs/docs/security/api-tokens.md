---
sidebar_position: 4
---

# API Tokens

API tokens provide scoped access to the DaoFlow API for CLI, CI/CD, and AI agents.

## Creating Tokens

### Via Dashboard

1. Go to **Settings → Tokens**
2. Click **Create Token**
3. Enter a name and select scopes
4. Copy the generated token (shown only once)

### Via API

```bash
# 1. Create or select an agent principal
POST /trpc/createAgent
{
  "json": {
    "name": "ci-deploy-agent",
    "preset": "agent:minimal-write"
  }
}

# 2. Generate a token for that principal
POST /trpc/generateAgentToken
{
  "json": {
    "principalId": "prin_abc123",
    "tokenName": "ci-deploy",
    "expiresInDays": 90
  }
}
```

`createAgent` is role-gated to `owner` and `admin`. `generateAgentToken` requires the `tokens:manage` scope and an admin-capable role.

## Token Properties

| Property      | Description                                |
| ------------- | ------------------------------------------ |
| **Name**      | Human-readable label                       |
| **Scopes**    | Granted permission scopes                  |
| **Lane**      | Computed: `read`, `planning`, or `command` |
| **Principal** | The user/agent this token belongs to       |
| **Expiry**    | When the token expires (optional)          |
| **Status**    | `active` or `revoked`                      |

## Lane Mapping

Tokens are classified into lanes based on their scopes:

| Lane         | Contains Scopes                                                |
| ------------ | -------------------------------------------------------------- |
| **read**     | Only read scopes (`*:read`, `events:read`, `diagnostics:read`) |
| **planning** | Read scopes + planning-related (no mutations)                  |
| **command**  | Any write/mutating scope                                       |

## Security Best Practices

- **Least privilege** — grant only the scopes needed
- **Short expiry** — use 30-90 day TTL for CI tokens
- **Separate tokens** — use different tokens for read vs deploy
- **Revoke unused** — revoke tokens when no longer needed
- **Never share** — tokens are shown only once at creation

## Using Tokens

```bash
# CLI
daoflow login --url https://deploy.example.com --token dfl_abc123

# curl
curl -H "Authorization: Bearer dfl_abc123" \
  https://deploy.example.com/trpc/viewer
```

## Effective Permissions

DaoFlow evaluates API tokens as:

`effective capabilities = principal role capabilities ∩ token scopes`

Examples:

- An `owner` token scoped to `deploy:read` can inspect deployments but cannot mutate infrastructure
- An `agent` token scoped to read endpoints cannot exceed the built-in `agent` role ceiling
- Revoked, expired, or invalidated tokens are rejected before the request reaches tRPC procedures
