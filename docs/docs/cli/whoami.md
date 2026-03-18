---
sidebar_position: 10
---

# daoflow whoami

Display the current authenticated principal's identity, role, and auth mode.

## Usage

```bash
daoflow whoami [options]
```

## Options

| Flag     | Description            |
| -------- | ---------------------- |
| `--json` | Structured JSON output |

## Required Scope

Any valid token.

## Examples

```bash
# Human-readable
daoflow whoami

# JSON for agents
daoflow whoami --json
```

## JSON Output

```json
{
  "ok": true,
  "data": {
    "principal": {
      "id": "usr_abc123",
      "name": "Alice",
      "email": "alice@example.com",
      "type": "user",
      "linkedUserId": "usr_abc123"
    },
    "role": "admin",
    "scopes": ["server:read", "server:write", "deploy:read", "deploy:start", "logs:read"],
    "authMethod": "session",
    "token": null,
    "session": {
      "id": "session_abc123",
      "expiresAt": "2026-03-16T10:00:00Z"
    }
  }
}
```

For API-token logins, `authMethod` is `"api-token"` and `session` is `null`. Token metadata is returned under `data.token`.
