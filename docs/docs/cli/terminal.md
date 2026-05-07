---
sidebar_position: 10
---

# daoflow terminal

Open an explicitly gated interactive service terminal.

## Usage

```bash
daoflow terminal service --service <id> [options]
```

## Required Scope

`terminal:open`

## Options

| Flag              | Description                                  |
| ----------------- | -------------------------------------------- |
| `--service <id>`  | Service ID for the running service container |
| `--shell <shell>` | `bash` or `sh`, defaults to `bash`           |
| `--json`          | Return structured preflight errors           |

## Examples

```bash
daoflow terminal service --service svc_api
daoflow terminal service --service svc_api --shell sh
```

## Notes

- Terminal access requires an interactive TTY.
- `terminal:open` is not part of default agent presets.
- The CLI does not accept a one-shot command string; it only opens an audited interactive session.
- JSON mode is for preflight errors only because terminal byte streams are not JSON encoded.
