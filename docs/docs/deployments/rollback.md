---
sidebar_position: 5
---

# Rollback

DaoFlow supports rolling back to any previous successful deployment. Rollbacks create a new deployment record targeting an earlier configuration.

## How Rollback Works

1. DaoFlow identifies the target deployment (default: previous successful)
2. Creates a new deployment record with the target's configuration
3. Re-deploys using the recorded image tag, compose file, and config
4. The rollback itself is a full deployment with its own steps and logs

## CLI Usage

```bash
# Rollback to previous successful deployment
daoflow rollback --service my-app --yes

# Rollback to a specific deployment
daoflow rollback --service my-app --to dep_abc123 --yes

# Preview rollback without executing
daoflow rollback --service my-app --dry-run --json
```

## Rollback vs Revert

| | Rollback | Revert |
|--|---------|--------|
| Creates new deployment record | ✅ | ❌ |
| Preserves audit trail | ✅ | ❌ |
| Can target any previous deploy | ✅ | Only last |
| Requires `deploy:rollback` scope | ✅ | N/A |

## Required Scope

`deploy:rollback`

## Safety

- Rollback plans can be previewed with `--dry-run`
- Each rollback creates a full audit record
- The original deployment records are never modified
- Config snapshots ensure exact reproduction
