---
sidebar_position: 9
---

# daoflow maintenance

Inspect and run the audited operational maintenance cleanup used by the control plane.

## Usage

```bash
daoflow maintenance report [options]
daoflow maintenance run [options]
```

## Required Scope

`server:write`

## Options

| Command | Flag        | Description                        |
| ------- | ----------- | ---------------------------------- |
| report  | `--json`    | Emit the standard JSON envelope    |
| run     | `--dry-run` | Preview cleanup without mutating   |
| run     | `--yes`     | Confirm a live maintenance cleanup |
| run     | `--json`    | Emit the standard JSON envelope    |

## Examples

```bash
daoflow maintenance report --json
daoflow maintenance run --dry-run --json
daoflow maintenance run --yes
```

## Notes

- Maintenance covers stalled deployments, stale preview environments, expired CLI sign-ins, and retained upload artifacts.
- `run` without `--dry-run` requires `--yes`.
- Both dry runs and live runs are recorded in the audit trail.
