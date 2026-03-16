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
