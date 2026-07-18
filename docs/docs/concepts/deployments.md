---
sidebar_position: 4
---

# Deployments

A deployment represents a single attempt to release a version of a service to a target server. Every deployment creates an immutable record with full context.

## Deployment Lifecycle

```
queued → prepare → deploy → finalize → completed
                                    └→ failed
```

| Status      | Description                                 |
| ----------- | ------------------------------------------- |
| `queued`    | Deployment requested, waiting to start      |
| `prepare`   | Pulling images, building, cloning repos     |
| `deploy`    | Running `docker compose up` or `docker run` |
| `finalize`  | Health checks, post-deploy verification     |
| `completed` | Successfully deployed                       |
| `failed`    | Deployment failed at some step              |

## Deployment Record

Every deployment records:

- **Input** — source type, image tag, commit SHA, compose file
- **Config snapshot** — resolved configuration at deploy time
- **Actor** — who requested it (user ID, email, role)
- **Trigger** — how it was initiated (`user`, `webhook`, `api`, `agent`)
- **Target** — which server and environment
- **Timestamps** — created, concluded
- **Outcome** — succeeded, failed, canceled, skipped
- **Steps** — structured timeline of what happened
- **Logs** — raw stdout/stderr from the deployment

DaoFlow now keeps three operator-facing views of deployment truth:

- **Declared config** — the repository branch, compose files, compose profiles, and target metadata DaoFlow selected before the rollout.
- **Frozen deployment input** — the replayable snapshot DaoFlow actually queued, including Compose environment evidence, readiness gates, image overrides, and preview metadata when present.
- **Stored drift context** — a cached, non-authoritative record of a prior runtime observation when one exists. It is never presented as proof of what is running now.

The dashboard exposes these sections directly in deployment details, and operators can copy or download the JSON artifact for debugging and recovery.

## Compose Drift Containment

`daoflow drift` is a read-only, team-scoped endpoint that requires `deploy:read`. In the current containment phase, DaoFlow does not connect to Docker or SSH to inspect a host. Each result therefore states whether it is a `cached-snapshot` or `unavailable`, includes `attemptedAt`, `observedAt`, `maxAgeSeconds`, and `authoritative: false`, and never reports a service as currently aligned.

A cached record can still preserve a previously detected mismatch for review, but it is not current evidence. A legacy cached value that said “aligned” is returned as unavailable instead. The later live phase will require strict SSH identity verification and DaoFlow-owned resource selection before it can collect narrowly formatted runtime fields. It will persist normalized diffs and safe evidence identifiers only—never raw `docker inspect` output, environment values, or credentials.

## Deployment Sources

DaoFlow supports three deployment sources:

| Source         | Description               | Example                             |
| -------------- | ------------------------- | ----------------------------------- |
| **Compose**    | Docker Compose file       | `--compose ./compose.yaml`          |
| **Dockerfile** | Build from repository     | `--repo https://github.com/org/app` |
| **Image**      | Pre-built container image | `--image nginx:alpine`              |

## Deployment Steps

Each deployment is broken into structured steps for clarity:

1. **Clone** — Clone git repository (if applicable)
2. **Build** — Build Docker image (if Dockerfile)
3. **Pull** — Pull container image
4. **Volume** — Create/verify named volumes
5. **Start** — Start containers
6. **Health** — Run health checks
7. **Finalize** — Mark deployment as complete

Each step has its own status, start time, and completion time.

## Permissions

| Action                  | Required Scope    |
| ----------------------- | ----------------- |
| View deployment history | `deploy:read`     |
| Start a deployment      | `deploy:start`    |
| Cancel a deployment     | `deploy:cancel`   |
| Rollback a deployment   | `deploy:rollback` |
