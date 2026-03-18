---
sidebar_position: 2
---

# daoflow login

Authenticate the CLI with a DaoFlow instance.

## Usage

```bash
daoflow login --url <api_url> (--token <token> | --email <email> --password <password> | --sso)
```

## Options

| Flag         | Required | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `--url`      | Yes      | URL of the DaoFlow instance                       |
| `--token`    | No       | DaoFlow API token or Better Auth session token    |
| `--email`    | No       | Email address for password sign-in                |
| `--password` | No       | Password for password sign-in                     |
| `--sso`      | No       | Start browser/device-code login                   |
| `--context`  | No       | Context name to store in `~/.daoflow/config.json` |
| `--json`     | No       | Structured JSON output                            |

## Behavior

1. Accepts exactly one auth mode: token, email/password, or SSO
2. Validates the credential against the control plane identity endpoint
3. For `--sso`, prints the verification URL and user code, opens a browser when possible, and falls back to manual device-code approval when it cannot
4. Stores credentials in `~/.daoflow/config.json` with auth metadata
5. Saves config with owner-only file permissions (`0600`)

## Examples

```bash
# Login with an API token
daoflow login --url http://localhost:3000 --token dfl_abc123

# Login with email/password
daoflow login --url http://localhost:3000 --email owner@daoflow.local --password secret1234

# Login with SSO
daoflow login --url https://deploy.example.com --sso

# If no browser can be opened, the CLI prints a verification URL,
# waits for you to approve the session in another browser,
# and prompts for the one-time CLI code shown on the approval page.

# Verify your login
daoflow whoami --json
```

## Token Storage

Credentials are stored in `~/.daoflow/config.json`:

```json
{
  "currentContext": "default",
  "contexts": {
    "default": {
      "apiUrl": "https://deploy.example.com",
      "token": "dfl_prod_xyz",
      "authMethod": "api-token"
    }
  }
}
```

The CLI also honors `DAOFLOW_URL` and `DAOFLOW_TOKEN` as an auth fallback for non-interactive automation.

> **Security note:** The config file should be readable only by your user. The CLI creates it with `0600` permissions and the config directory with `0700`.
