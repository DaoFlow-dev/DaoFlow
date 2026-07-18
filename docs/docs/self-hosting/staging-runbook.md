---
sidebar_position: 4
---

# Staging Runbook

Use this guide to rehearse DaoFlow on a non-production host before promoting the same operating pattern to production.

## Goals

A staging rollout should prove:

- the control plane boots cleanly from the shipped compose stack
- you can register at least one deployment target
- deploy, logs, rollback discovery, and backup flows work end to end
- your team knows where to look when something fails

## 1. Provision The Host

Recommended baseline:

- Linux host with Docker Engine + Compose v2
- DNS name or private access path for the control plane
- outbound internet access for image pulls
- at least one separate managed Docker host for remote deploy rehearsal

See [Requirements](./requirements) for the exact prerequisites.

## 2. Install DaoFlow

Recommended path:

```bash
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --dir /opt/daoflow-staging \
  --domain staging-daoflow.example.com \
  --email owner@example.com \
  --password 'replace-this-secret' \
  --yes
```

This uses the default lean workflow profile. To rehearse the durable workflow path instead, add
`--workflow-profile temporal`; the installer persists the matching Temporal settings in `.env`.

If you prefer manual control, use the repository production `docker-compose.yml` plus a copy of `.env.example` as described in [Docker Compose Setup](./docker-compose).

### Local-Source QA Build

Use this path when you need to validate the current source revision before a release image exists.
Run it from a clean checkout on the QA host, or transfer the exact clean revision to that host
first. Keep this source checkout separate from an installer-managed directory; the commands below
use `/opt/daoflow-source-qa`:

```bash
cd /opt/daoflow-source-qa

test -z "$(git status --short)" || {
  echo "Working tree is not clean" >&2
  exit 1
}

REVISION=$(git rev-parse --short=12 HEAD)
IMAGE_TAG="qa-${REVISION}"

docker build \
  --target runtime \
  --tag "ghcr.io/daoflow-dev/daoflow:${IMAGE_TAG}" \
  .
```

The explicit `runtime` target is required because the Dockerfile's final target builds the
development-task runner. If the build machine and QA host use different CPU architectures, build
on the QA host or use Docker Buildx for the QA host's platform.

Copy `.env.example` to `.env`, generate fresh staging-only secrets, and set
`DAOFLOW_VERSION=qa-<revision>`. For a fresh database, also set both
`DAOFLOW_INITIAL_ADMIN_EMAIL` and `DAOFLOW_INITIAL_ADMIN_PASSWORD`; the server only bootstraps an
owner when both values are present. Do not publish the QA address, owner password, or generated
secrets in documentation, issues, or test output.

The remaining commands default to the installer directory. For the local-source path, set:

```bash
export DAOFLOW_DIR=/opt/daoflow-source-qa
```

## 3. Review The Generated `.env`

Before the first rehearsal, confirm at least:

- `BETTER_AUTH_URL` points at your staging origin
- `DAOFLOW_VERSION` is pinned to the release or `qa-<revision>` image you want to rehearse
- `DAOFLOW_WORKFLOW_PROFILE=lean`, `COMPOSE_PROFILES=` (no active profile), and
  `DAOFLOW_ENABLE_TEMPORAL=false` for the first pass
- `POSTGRES_PASSWORD` is non-empty; `TEMPORAL_POSTGRES_PASSWORD` is required only for a Temporal run
- `DAOFLOW_BIND=0.0.0.0` only when the QA network is trusted and direct LAN access is intentional

For a released image, pull the full stack and wait for its health checks:

```bash
cd "${DAOFLOW_DIR:-/opt/daoflow-staging}"
docker compose pull
docker compose up -d --wait --wait-timeout 300
```

For a local-only `qa-<revision>` image, use this instead so Compose does not try to fetch the
local-only DaoFlow tag:

```bash
cd "${DAOFLOW_DIR:-/opt/daoflow-staging}"
docker compose pull postgres redis
docker compose up -d --wait --wait-timeout 300
```

For a Temporal rehearsal, set all three profile values in `.env` first, then pull and start the
profiled dependencies:

```bash
cd "${DAOFLOW_DIR:-/opt/daoflow-staging}"
docker compose --profile temporal pull temporal-postgresql temporal
docker compose --profile temporal up -d temporal
docker compose --profile temporal exec -T temporal \
  temporal operator cluster health --address temporal:7233
docker compose up -d --wait --wait-timeout 300 daoflow
```

## 4. Verify The Control Plane

```bash
cd "${DAOFLOW_DIR:-/opt/daoflow-staging}"
docker compose ps
docker compose logs --tail=200 daoflow
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

Expected result:

- Lean rehearsal: only `daoflow`, `postgres`, and `redis` are running
- Temporal rehearsal: the lean services plus `temporal-postgresql` and `temporal` are running;
  `temporal-ui` only runs when its separate profile is enabled
- `/health` responds and `/ready` returns `ready`
- the `daoflow` logs show database migrations completed before the HTTP server started
- the UI loads and you can sign in as the initial owner
- the **Servers** page reports the bootstrapped local target with Docker and Compose ready

Then prove persisted state and authentication survive a full service restart:

```bash
docker compose restart
docker compose up -d --wait --wait-timeout 300
curl -fsS http://127.0.0.1:3000/ready
```

Sign in again after the restart and confirm the local target remains ready. When `.env` changes,
use `docker compose up -d` rather than `docker compose restart`, because restart does not reload the
environment file.

## 5. Register A Deployment Target

Today, target server registration is done in the dashboard or admin API, not the CLI.

In the dashboard:

1. Open **Servers**
2. Add the staging target host
3. Confirm SSH connectivity plus Docker and Compose detection

## 6. Rehearse A Deployment

For a first greenfield exercise, use direct Compose deploy:

```bash
daoflow deploy --compose ./compose.yaml --server srv_staging_1 --dry-run --json
daoflow deploy --compose ./compose.yaml --server srv_staging_1 --yes
```

Then verify:

```bash
daoflow logs --deployment <deployment-id> --json
daoflow status --json
daoflow doctor --json
```

If you already modeled a service in the dashboard, also rehearse the service-ID path:

```bash
daoflow deploy --service svc_my_app --dry-run --json
daoflow deploy --service svc_my_app --yes
```

## 7. Rehearse Rollback Discovery

```bash
daoflow rollback --service svc_my_app --json
daoflow rollback --service svc_my_app --target <deployment-id> --dry-run
```

The list operation confirms rollback targets exist and the dry-run proves the planning lane can resolve them before any production incident forces you to learn under pressure.

## 8. Rehearse Backup Operations

Backup policies and destinations are configured in the dashboard or admin API. Once they exist:

```bash
daoflow backup list --json
daoflow backup run --policy bkp_pol_123 --yes
daoflow backup verify --backup-run-id bkp_run_123 --yes
```

## 9. Optional: Rehearse Temporal

After the baseline rehearsal is green, you can exercise durable orchestration:

```bash
cd "${DAOFLOW_DIR:-/opt/daoflow-staging}"
daoflow install --dir "${DAOFLOW_DIR:-/opt/daoflow-staging}" --workflow-profile temporal --yes
docker compose logs --tail=200 daoflow temporal
```

The temporal install persists:

```bash
DAOFLOW_WORKFLOW_PROFILE=temporal
COMPOSE_PROFILES=temporal
DAOFLOW_ENABLE_TEMPORAL=true
```

If Temporal mode is unstable, rerun the installer with `--workflow-profile lean`. It explains the
transition plan before mutation, stops and removes the Temporal containers, and preserves the
`temporal-pgdata` named volume. Do not use `docker compose down -v` for this rollback.

## Exit Checklist

- Tested Git revision and QA image tag recorded
- Control plane healthy and ready after restart
- Owner sign-in works before and after restart
- Managed target reachable over SSH
- At least one deployment dry-run and one real deployment succeed
- Deployment logs visible through UI or `daoflow logs --deployment`
- Rollback targets discoverable
- Backup run and verify workflow exercised
- Incident recovery guide reviewed by the operator on call
- No QA credentials or private host details copied into repository documentation or test reports
