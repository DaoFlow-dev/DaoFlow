---
sidebar_position: 4
---

# API for Agents

Best practices for AI agents using the DaoFlow API directly.

## Three-Lane Safety

Always use the appropriate API lane:

| Lane | When to Use | Safe for Agents |
|------|-------------|----------------|
| **Read** | Observing state | ✅ Always safe |
| **Planning** | Previewing changes | ✅ Always safe |
| **Command** | Executing mutations | ⚠️ Requires write scopes |

## Recommended API Flow

```
1. GET /trpc/capabilities          → Know your scopes
2. GET /trpc/infrastructureInventory → See current state
3. POST /trpc/deploymentPlan       → Preview changes
4. POST /trpc/createDeploymentRecord → Execute (if plan is good)
5. GET /trpc/recentDeployments     → Verify result
```

## Idempotency

Always include idempotency keys for command endpoints:

```bash
POST /trpc/createDeploymentRecord
X-Idempotency-Key: deploy-my-app-2026-03-15-v3
```

This prevents duplicate deployments if the agent retries.

## Error Handling

Parse structured errors from the API:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Scope denied: deploy:start required",
    "data": {
      "requiredScopes": ["deploy:start"],
      "grantedScopes": ["deploy:read"]
    }
  }
}
```

When you receive `FORBIDDEN`, report the required scope to the user rather than retrying.

## Rate Limits

Agent tokens have rate limits. If exceeded, wait for `retryAfter` seconds:

```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "data": { "retryAfter": 30 }
  }
}
```

## Agent-Friendly Diagnostics

The API provides special diagnostic endpoints for agents:

- **"Why did this deploy fail?"** — use deployment logs + event timeline
- **"Compare deploys"** — use `configDiff` endpoint
- **"What changed?"** — use `eventTimeline` filtered by service
