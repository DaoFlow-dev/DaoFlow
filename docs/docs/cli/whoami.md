---
sidebar_position: 10
---

# daoflow whoami

Display the current authenticated principal's identity, role, and session.

## Usage

```bash
daoflow whoami [options]
```

## Options

| Flag | Description |
|------|-------------|
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
  "principal": {
    "id": "usr_abc123",
    "name": "Alice",
    "email": "alice@example.com",
    "role": "admin",
    "type": "user",
    "scopes": ["server:read", "server:write", "deploy:read", "deploy:start", "logs:read"]
  },
  "session": {
    "expiresAt": "2026-03-16T10:00:00Z"
  }
}
```
