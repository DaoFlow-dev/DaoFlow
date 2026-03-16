---
sidebar_position: 1
---

# API Reference

DaoFlow's API is built with [tRPC](https://trpc.io) and organized into three lanes for safety.

## Three-Lane Model

| Lane         | Purpose             | Side Effects | Example                                                             |
| ------------ | ------------------- | ------------ | ------------------------------------------------------------------- |
| **Read**     | Query current state | None         | `health`, `recentDeployments`, `infrastructureInventory`            |
| **Planning** | Preview changes     | None         | `deploymentPlan`, `rollbackPlan`, `configDiff`                      |
| **Command**  | Execute mutations   | Yes          | `createDeploymentRecord`, `registerServer`, `updateApprovalRequest` |

## Base URL

```
http://localhost:3000/trpc
```

## Authentication

All API requests (except `health`) require authentication via:

- **Session cookie** — for browser-based access
- **Bearer token** — for CLI and agent access

```bash
curl -H "Authorization: Bearer dfl_your_token" \
  http://localhost:3000/trpc/health
```

See [Authentication](./authentication) for details.

## Request Format

tRPC uses JSON-encoded query parameters for reads and JSON body for mutations:

```bash
# Read (query)
GET /trpc/recentDeployments?input={"json":{"limit":10}}

# Command (mutation)
POST /trpc/createDeploymentRecord
Content-Type: application/json
{"json":{"serviceName":"my-app","targetServerId":"srv_123",...}}
```

## Error Responses

All errors follow a consistent shape:

```json
{
  "error": {
    "message": "Permission denied",
    "code": "FORBIDDEN",
    "data": {
      "requiredScopes": ["deploy:start"],
      "grantedScopes": ["deploy:read", "server:read"]
    }
  }
}
```

See [Error Handling](./error-handling) for the full error catalog.
