---
sidebar_position: 1
---

# API Reference

DaoFlow's API is built with [tRPC](https://trpc.io) and organized into three lanes for safety.

## Generated Contract Artifacts

The published API contract is generated from the live router and committed as static artifacts:

- [`api-contract.json`](/contracts/api-contract.json) — full procedure inventory, HTTP method, auth requirements, role and scope requirements, and input JSON Schema for every exported procedure

The artifact is regenerated with `bun run contracts:generate` and validated with `bun run contracts:check`.
CI also runs the check so docs cannot drift silently.

## Three-Lane Model

| Lane         | Purpose             | Side Effects | Examples                                                                |
| ------------ | ------------------- | ------------ | ----------------------------------------------------------------------- |
| **Read**     | Query current state | None         | `health`, `viewer`, `recentDeployments`, `infrastructureInventory`      |
| **Planning** | Preview changes     | None         | `deploymentPlan`, `composeDeploymentPlan`, `rollbackPlan`, `configDiff` |
| **Command**  | Execute mutations   | Yes          | `triggerDeploy`, `registerServer`, `requestApproval`                    |

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

tRPC uses JSON-encoded query parameters for queries and JSON body for mutations:

```bash
# Query
GET /trpc/recentDeployments?input={"json":{"limit":10}}

# Mutation
POST /trpc/triggerDeploy
Content-Type: application/json
{"json":{"serviceId":"svc_my_api","imageTag":"ghcr.io/acme/api:1.4.2"}}
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

See [Error Handling](./error-handling) for the full error catalog and [`api-contract.json`](/contracts/api-contract.json) for the exact exported procedure list.
