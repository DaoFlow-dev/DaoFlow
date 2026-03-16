---
sidebar_position: 7
---

# daoflow env

Manage environment variables for project environments.

## Subcommands

### env list

List environment variables (values are masked by default).

```bash
daoflow env list --project my-app --env production --json
```

**Required scope:** `env:read`

### env set

Set or update an environment variable.

```bash
daoflow env set --project my-app --env production \
  DATABASE_URL=postgresql://... --yes
```

**Required scope:** `env:write`

### env delete

Remove an environment variable.

```bash
daoflow env delete --project my-app --env production \
  OLD_VARIABLE --yes
```

**Required scope:** `env:write`

## Options

| Flag               | Description                                |
| ------------------ | ------------------------------------------ |
| `--project <name>` | Target project (required)                  |
| `--env <name>`     | Target environment (default: `production`) |
| `--yes`            | Skip confirmation for set/delete           |
| `--json`           | Structured JSON output                     |

## JSON Output (list)

```json
{
  "ok": true,
  "variables": [
    { "key": "DATABASE_URL", "masked": true, "updatedAt": "2026-03-15T10:00:00Z" },
    { "key": "REDIS_URL", "masked": true, "updatedAt": "2026-03-14T08:00:00Z" }
  ]
}
```

## Security

- Values are encrypted at rest using the `ENCRYPTION_KEY`
- `env list` masks values by default — use `secrets:read` scope to see unmasked values
- All set/delete operations create audit records
