---
sidebar_position: 4
---

# API for Agents

Best practices for AI agents using the DaoFlow API directly.

## Three-Lane Safety

Always use the appropriate API lane:

| Lane         | When to Use         | Safe for Agents          |
| ------------ | ------------------- | ------------------------ |
| **Read**     | Observing state     | ✅ Always safe           |
| **Planning** | Previewing changes  | ✅ Always safe           |
| **Command**  | Executing mutations | ⚠️ Requires write scopes |

## Recommended API Flow

```
1. GET /trpc/viewer                → Know your auth method, role, and granted scopes
2. GET /trpc/infrastructureInventory or /trpc/services → See current state
3. GET /trpc/deploymentPlan or /trpc/composeDeploymentPlan → Preview changes
4. POST /trpc/triggerDeploy        → Execute a service deploy when the plan is acceptable
5. GET /trpc/recentDeployments or /trpc/deploymentLogs → Verify the queued result
```

Use [`api-contract.json`](/contracts/api-contract.json) as the authoritative machine-readable inventory instead of reverse-engineering route names from source.

## Idempotency

Where your client stack supports idempotency or replay protection, keep the key stable across retries for the same intended mutation.

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

- **"Why did this deploy fail?"** — use `deploymentLogs` plus `operationsTimeline`
- **"Compare deploys"** — use `configDiff` endpoint
- **"What changed?"** — use `operationsTimeline` or `auditTrail`, depending on whether you need runtime events or write-audit history
