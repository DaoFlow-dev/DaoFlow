---
sidebar_position: 11
---

# daoflow capabilities

List all scopes granted to the current token, grouped by type.

## Usage

```bash
daoflow capabilities [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--json` | Structured JSON output |

## Required Scope

Any valid token.

## Examples

```bash
daoflow capabilities --json
```

## JSON Output

```json
{
  "ok": true,
  "role": "developer",
  "scopes": {
    "read": ["server:read", "deploy:read", "service:read", "env:read", "logs:read", "events:read"],
    "write": ["deploy:start", "env:write"]
  },
  "total": 8
}
```

## Agent Usage

Use `capabilities` before performing operations to check if your token has the required scopes. This prevents `SCOPE_DENIED` errors.

```bash
# Check if we can deploy
CAPS=$(daoflow capabilities --json)
echo $CAPS | jq '.scopes.write | index("deploy:start")'
```
