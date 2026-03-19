---
sidebar_position: 3
---

# Read Endpoints

Read endpoints are safe to call — they never modify state.

## health

Check API availability.

```
GET /trpc/health
```

**Scope:** None (public)

**Response:**

```json
{ "result": { "data": { "json": { "status": "ok", "version": "0.1.0" } } } }
```

## platformOverview

Get platform info, thesis, and product principles.

```
GET /trpc/platformOverview
```

**Scope:** Any valid token

## infrastructureInventory

List all servers, projects, and services.

```
GET /trpc/infrastructureInventory
```

**Scope:** `server:read`, `service:read`

**Response includes:**

- `servers[]` — name, host, status, Docker version
- `projects[]` — name, environment count, service count, latest deployment status
- `services[]` — name, source type, status

## recentDeployments

Get recent deployment history.

```
GET /trpc/recentDeployments?input={"json":{"limit":50}}
```

**Scope:** `deploy:read`

## composePreviews

Get the latest preview lifecycle state for a compose service.

```
GET /trpc/composePreviews?input={"json":{"serviceId":"svc_abc123"}}
```

**Scope:** `deploy:read`

**Response includes:**

- `service` — the scoped compose service identity
- `previews[]` — one item per preview key with source branch, optional pull request number, isolated stack name, preview env branch, latest deploy or destroy action, normalized status, timestamps, and whether the preview is currently active

## composePreviewReconciliation

Compare desired preview metadata against observed tunnel-route state and stale-preview policy for a compose service.

```
GET /trpc/composePreviewReconciliation?input={"json":{"serviceId":"svc_abc123"}}
```

**Scope:** `deploy:read`

**Response includes:**

- `service` — the scoped compose service identity plus preview config
- `policy.staleAfterHours` — the configured preview retention window, if any
- `summary` — counts for in-sync, drifted, stale, unmanaged, and garbage-collectable previews
- `previews[]` — one item per preview key with desired domain, observed tunnel route, reconciliation status, stale cutoff, and GC eligibility

## backupOverview

Get backup policies and recent runs.

```
GET /trpc/backupOverview?input={"json":{}}
```

**Scope:** `backup:read`

## eventTimeline

Get structured operational events.

```
GET /trpc/eventTimeline?input={"json":{"limit":100}}
```

**Scope:** `events:read`

## auditLog

Get audit trail of write operations.

```
GET /trpc/auditLog?input={"json":{"limit":50}}
```

**Scope:** `events:read`

## capabilities

List scopes granted to the current token.

```
GET /trpc/capabilities
```

**Scope:** Any valid token
