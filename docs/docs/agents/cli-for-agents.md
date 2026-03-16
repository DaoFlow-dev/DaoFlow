---
sidebar_position: 3
---

# CLI for Agents

Best practices for AI agents using the DaoFlow CLI.

## Golden Rules

1. **Always use `--json`** — structured output is machine-parseable
2. **Always `--dry-run` before `--yes`** — preview before executing
3. **Check `capabilities` first** — know your scopes before acting
4. **Use `--quiet` for piping** — get just the value you need
5. **Handle exit codes** — 0=success, 1=error, 2=denied, 3=dry-run

## Recommended Workflow

```bash
# 1. Check identity and permissions
daoflow whoami --json
daoflow capabilities --json

# 2. Observe current state
daoflow status --json

# 3. Plan the deployment
daoflow plan --service my-app --server prod --json

# 4. Preview execution
daoflow deploy --service my-app --server prod --compose ./compose.yaml --dry-run --json

# 5. Execute (only if dry-run looks good)
daoflow deploy --service my-app --server prod --compose ./compose.yaml --yes --json

# 6. Verify
daoflow status --json
daoflow logs --service my-app --tail 20 --json
```

## Error Handling

```bash
# Parse errors from JSON
RESULT=$(daoflow deploy --service my-app --yes --json 2>/dev/null)
OK=$(echo $RESULT | jq -r '.ok')

if [ "$OK" = "false" ]; then
  ERROR=$(echo $RESULT | jq -r '.error')
  CODE=$(echo $RESULT | jq -r '.code')
  echo "Failed: $ERROR (code: $CODE)"
fi
```

## Exit Code Reference

| Code | Meaning | Agent Action |
|------|---------|-------------|
| `0` | Success | Proceed |
| `1` | Error | Read error message, diagnose |
| `2` | Permission denied | Check required scope, request elevation |
| `3` | Dry-run complete | Review plan, decide to execute |

## Timeout Handling

```bash
# Set a 60-second timeout for slow deployments
daoflow deploy --service my-app --yes --timeout 60 --json
```
