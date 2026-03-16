---
sidebar_position: 2
---

# Getting Started with Agents

Set up your first AI agent to interact with DaoFlow.

## Step 1: Create an Agent Principal

In the DaoFlow dashboard, go to **Settings → Users → Add Principal** and select **Agent**.

## Step 2: Generate a Token

Create an API token for the agent with appropriate scopes:

```bash
# Read-only token (safest starting point)
Scopes: server:read, deploy:read, service:read, logs:read, events:read

# Deploy-capable token
Scopes: + deploy:start, deploy:rollback, env:read
```

## Step 3: Configure Your AI Tool

### Cursor / Windsurf / Cline

Add to your agent instructions:

```
You have access to DaoFlow for deployment management.
Use the following CLI commands:
- daoflow status --json          # Check infrastructure health
- daoflow plan --json            # Preview deployment plans
- daoflow deploy --dry-run --json # Preview a deployment
- daoflow deploy --yes --json   # Execute a deployment
- daoflow logs --json           # View deployment logs
- daoflow doctor --json         # Diagnose issues

Always use --json for structured output.
Always use --dry-run before --yes.
```

### GitHub Actions / CI

```yaml
- name: Deploy via DaoFlow
  env:
    DAOFLOW_TOKEN: ${{ secrets.DAOFLOW_TOKEN }}
  run: |
    daoflow login --url ${{ vars.DAOFLOW_URL }} --token $DAOFLOW_TOKEN
    daoflow deploy --service my-app --server prod --yes --json
```

## Step 4: Verify

```bash
daoflow whoami --json
daoflow capabilities --json
daoflow status --json
```
