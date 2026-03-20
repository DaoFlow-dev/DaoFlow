---
sidebar_position: 2
---

# Authentication

DaoFlow supports two authentication methods: session-based (for the web UI) and token-based (for CLI and agents).

## Session Authentication

The web dashboard uses Better Auth with email/password:

1. User signs up or logs in via the web UI
2. A session cookie is set with `httpOnly` and `secure` flags
3. All subsequent requests include the cookie automatically

## Token Authentication

For CLI and agent access, use API tokens:

```bash
curl -H "Authorization: Bearer dfl_your_token_here" \
  http://localhost:3000/trpc/viewer
```

DaoFlow now resolves Bearer tokens directly inside the tRPC request context. Effective access is the intersection of:

1. The principal role capabilities
2. The presented token scopes

That means a token can only narrow a principal, never widen it.

### Creating Tokens

Agent tokens are created in the dashboard or through the admin API in two steps:

```bash
# 1. Create the agent principal
POST /trpc/createAgent
{
  "json": {
    "name": "ci-deploy-agent",
    "preset": "agent:minimal-write"
  }
}

# 2. Mint a token for that principal
POST /trpc/generateAgentToken
{
  "json": {
    "principalId": "prin_abc123",
    "tokenName": "ci-deploy-token",
    "expiresInDays": 90
  }
}
```

`createAgent` is role-gated to `owner` and `admin`. `generateAgentToken` requires the `tokens:manage` scope plus an admin-capable role.

For the full machine-readable contract, including the exact input JSON Schema for both procedures, use [`api-contract.json`](/contracts/api-contract.json).

### Token Format

Tokens follow the format: `dfl_<random_string>`

### Token Properties

| Property  | Description                                      |
| --------- | ------------------------------------------------ |
| Name      | Human-readable label                             |
| Scopes    | Granted permission scopes                        |
| Principal | The user/agent this token belongs to             |
| Expiry    | When the token expires (optional)                |
| Lane      | Computed from scopes: read, planning, or command |

### CLI Behavior

- `daoflow login --token dfl_...` stores the token as-is
- CLI requests with `dfl_...` tokens use `Authorization: Bearer ...`
- CLI requests with non-`dfl_...` tokens continue to use Better Auth session cookies
- `daoflow whoami --json` reports `authMethod`, token metadata, and `session: null` when the current identity is token-backed

## First User

The first user to sign up automatically receives the `owner` role with full permissions. Subsequent users get the `viewer` role by default.

## Password Reset And Session Recovery

- The web UI sends password reset requests through `POST /api/auth/request-password-reset`.
- Better Auth redirects valid reset links back into the SPA at `/reset-password?token=...`; invalid or expired links land on `/reset-password?error=INVALID_TOKEN`.
- DaoFlow redirects web users back to `/login?returnTo=...` whenever a protected browser request resolves to `401`, so expired sessions recover into a deterministic sign-in flow instead of leaving the UI in a broken state.

## Agent Principals

Agent accounts are dedicated identities for AI systems. They default to read-only scopes. See [Agent Principals](/docs/security/agent-principals) for setup.
