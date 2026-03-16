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
POST /trpc/createApiToken
{
  "json": {
    "name": "ci-deploy",
    "scopes": ["deploy:read", "deploy:start", "logs:read"],
    "expiresInDays": 90
  }
}
```

## Token Properties

| Property | Description |
|----------|-------------|
| **Name** | Human-readable label |
| **Scopes** | Granted permission scopes |
| **Lane** | Computed: `read`, `planning`, or `command` |
| **Principal** | The user/agent this token belongs to |
| **Expiry** | When the token expires (optional) |
| **Status** | `active` or `revoked` |

## Lane Mapping

Tokens are classified into lanes based on their scopes:

| Lane | Contains Scopes |
|------|----------------|
| **read** | Only read scopes (`*:read`, `events:read`, `diagnostics:read`) |
| **planning** | Read scopes + planning-related (no mutations) |
| **command** | Any write/mutating scope |

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
  https://deploy.example.com/trpc/healthCheck
```
