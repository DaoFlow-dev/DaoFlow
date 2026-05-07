---
sidebar_position: 9
---

# Access logs

`daoflow access-logs` reads durable request and access records from the control plane. Use it to investigate API token usage, failed auth, denied scopes, webhook traffic, slow requests, and server errors without shell access to container logs.

```bash
daoflow access-logs --limit 50
daoflow access-logs --status failed-auth --json
daoflow access-logs --request-id req-abc123 --json
daoflow access-logs --path "/api/webhooks/*" --min-duration-ms 1000 --json
```

Required scope: `logs:read`.

DaoFlow does not store request bodies, response bodies, cookies, authorization headers, raw bearer tokens, or raw query strings. API token display is limited to token id, name, and prefix.

## Filters

- `--limit <n>` caps returned entries from `1` to `100`.
- `--cursor <cursor>` fetches the next page from a previous JSON response.
- `--since <window>` accepts windows like `15m`, `1h`, `7d`, or `2w`.
- `--status <failed-auth|denied|error|slow|webhook|api-token>` applies common investigation filters.
- `--method`, `--path`, `--actor-type`, `--token`, `--request-id`, `--search`, and `--min-duration-ms` narrow the result set.

## JSON shape

```json
{
  "ok": true,
  "data": {
    "limit": 50,
    "cursor": null,
    "nextCursor": null,
    "summary": {
      "totalEntries": 1,
      "failedAuth": 0,
      "deniedScopes": 1,
      "webhookRequests": 1,
      "apiTokenRequests": 1,
      "slowRequests": 1,
      "errorResponses": 0
    },
    "retentionDays": 30,
    "entries": [
      {
        "id": "rlog_123",
        "requestId": "req-abc123",
        "method": "POST",
        "path": "/api/webhooks/github",
        "category": "webhook",
        "statusCode": 403,
        "outcome": "denied",
        "durationMs": 1200,
        "tokenPrefix": "dfl_ci_abcd",
        "errorCategory": "SCOPE_DENIED",
        "createdAt": "2026-05-06T18:00:00.000Z"
      }
    ]
  }
}
```
