---
sidebar_position: 7
---

# daoflow env

Manage environment variables for DaoFlow environments.

## Subcommands

### env list

List environment variables (values are masked by default).

```bash
daoflow env list --env-id env_prod_123 --json
```

**Required scope:** `env:read`

### env set

Set or update an environment variable.

```bash
daoflow env set --env-id env_prod_123 \
  --key DATABASE_URL \
  --value postgresql://... \
  --yes
```

**Required scope:** `env:write`

### env delete

Remove an environment variable.

```bash
daoflow env delete --env-id env_prod_123 \
  --key OLD_VARIABLE \
  --yes
```

**Required scope:** `env:write`

## Options

| Flag              | Description                                |
| ----------------- | ------------------------------------------ |
| `--env-id <id>`   | Target environment ID                      |
| `--key <key>`     | Variable key for set or delete             |
| `--value <value>` | Variable value for set                     |
| `--local`         | Write to a local `.env` instead of DaoFlow |
| `--file <path>`   | Local `.env` path when using `--local`     |
| `--yes`           | Skip confirmation for set or delete        |
| `--json`          | Structured JSON output                     |

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
