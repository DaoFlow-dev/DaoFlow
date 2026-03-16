---
sidebar_position: 2
---

# daoflow login

Authenticate the CLI with a DaoFlow instance.

## Usage

```bash
daoflow login --url <api_url> --token <api_token>
```

## Options

| Flag      | Required | Description                  |
| --------- | -------- | ---------------------------- |
| `--url`   | Yes      | URL of the DaoFlow instance  |
| `--token` | Yes      | API token for authentication |

## Behavior

1. Validates the token against the DaoFlow instance
2. Stores credentials in `~/.daoflow/config.json`
3. Verifies connectivity by calling `whoami`

## Examples

```bash
# Login to a local instance
daoflow login --url http://localhost:3000 --token dfl_abc123

# Login to a production instance
daoflow login --url https://deploy.example.com --token dfl_prod_xyz

# Verify your login
daoflow whoami --json
```

## Token Storage

Credentials are stored in `~/.daoflow/config.json`:

```json
{
  "apiUrl": "https://deploy.example.com",
  "token": "dfl_prod_xyz"
}
```

> **Security note:** The config file should be readable only by your user. The CLI creates it with `0600` permissions.
