---
sidebar_position: 6
---

# Error Handling

All DaoFlow API errors follow a consistent structure.

## Error Response Shape

```json
{
  "error": {
    "message": "Human-readable error description",
    "code": "MACHINE_CODE",
    "data": {
      "httpStatus": 403,
      "requiredScopes": ["deploy:start"],
      "grantedScopes": ["deploy:read"]
    }
  }
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | No valid token or session |
| `FORBIDDEN` | 403 | Token lacks required scope |
| `NOT_FOUND` | 404 | Resource does not exist |
| `BAD_REQUEST` | 400 | Invalid input parameters |
| `CONFLICT` | 409 | Duplicate or conflicting operation |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |

## Permission Denied

When a scope is denied, the response includes exactly which scopes were needed and which were granted:

```json
{
  "error": {
    "message": "Scope denied: deploy:start required",
    "code": "FORBIDDEN",
    "data": {
      "requiredScopes": ["deploy:start"],
      "grantedScopes": ["deploy:read", "server:read", "logs:read"]
    }
  }
}
```

## CLI Exit Codes

The CLI maps API errors to deterministic exit codes:

| Exit Code | Meaning | API Cause |
|-----------|---------|-----------|
| `0` | Success | 200/201 |
| `1` | General error | 400/404/500 |
| `2` | Permission denied | 401/403 |
| `3` | Dry-run completed | N/A (local) |

## Rate Limiting

API requests are rate-limited per token. If exceeded:

```json
{
  "error": {
    "message": "Rate limit exceeded. Try again in 30 seconds.",
    "code": "TOO_MANY_REQUESTS",
    "data": {
      "retryAfter": 30
    }
  }
}
```
