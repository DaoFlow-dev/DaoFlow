---
sidebar_position: 8
---

# diff

Compare two deployment records without executing anything.

## Scope

`deploy:read`

## Usage

```bash
daoflow diff --a <deployment-id> --b <deployment-id> --json
```

## Behavior

- Calls the planning-lane `configDiff` route
- Resolves both deployment IDs inside the caller's team scope
- Shows baseline/comparison metadata first, then scalar changes, then snapshot/config changes

## JSON Output

```json
{
  "ok": true,
  "data": {
    "a": {
      "id": "dep_baseline123",
      "projectName": "Acme",
      "environmentName": "production",
      "serviceName": "api",
      "status": "healthy",
      "statusLabel": "Healthy",
      "statusTone": "healthy",
      "commitSha": "abcdef1",
      "imageTag": "ghcr.io/acme/api:1.4.1",
      "sourceType": "compose",
      "targetServerName": "prod-us-west",
      "createdAt": "2026-03-17T19:00:00.000Z",
      "finishedAt": "2026-03-17T19:05:00.000Z",
      "stepCount": 5
    },
    "b": {
      "id": "dep_candidate456",
      "projectName": "Acme",
      "environmentName": "production",
      "serviceName": "api",
      "status": "failed",
      "statusLabel": "Failed",
      "statusTone": "failed",
      "commitSha": "fedcba9",
      "imageTag": "ghcr.io/acme/api:1.4.2",
      "sourceType": "compose",
      "targetServerName": "prod-us-west",
      "createdAt": "2026-03-17T20:00:00.000Z",
      "finishedAt": "2026-03-17T20:02:00.000Z",
      "stepCount": 4
    },
    "summary": {
      "sameProject": true,
      "sameEnvironment": true,
      "sameService": true,
      "changedScalarCount": 3,
      "changedSnapshotKeyCount": 2
    },
    "scalarChanges": [
      {
        "key": "commitSha",
        "baseline": "abcdef1",
        "comparison": "fedcba9"
      }
    ],
    "snapshotChanges": [
      {
        "key": "composePath",
        "baseline": "/srv/acme/api/compose.v1.yaml",
        "comparison": "/srv/acme/api/compose.v2.yaml"
      }
    ]
  }
}
```
