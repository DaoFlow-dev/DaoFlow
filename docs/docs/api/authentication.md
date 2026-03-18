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
  http://localhost:3000/trpc/health
```

DaoFlow now resolves Bearer tokens directly inside the tRPC request context. Effective access is the intersection of:

1. The principal role capabilities
2. The presented token scopes

That means a token can only narrow a principal, never widen it.

### Creating Tokens

Tokens are created in the dashboard under **Settings → Tokens** or via the API:

```bash
POST /trpc/createApiToken
{
  "json": {
    "name": "ci-deploy-token",
    "scopes": ["deploy:read", "deploy:start", "logs:read"],
    "expiresInDays": 90
  }
}
```

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

## Agent Principals

Agent accounts are dedicated identities for AI systems. They default to read-only scopes. See [Agent Principals](/docs/security/agent-principals) for setup.
