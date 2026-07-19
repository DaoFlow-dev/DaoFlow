---
sidebar_position: 3
---

# Docker Compose Setup

The repository root `docker-compose.yml` is the production reference stack. Use it as-is unless you intentionally own the consequences of diverging from the shipped topology.

## What The Reference Stack Includes

The current production file defines a lean base stack and two opt-in Compose profiles:

- Lean base: `daoflow`, `postgres`, and `redis`
- `temporal` profile: `temporal-postgresql` and `temporal`, the durable workflow substrate
- `temporal-ui` profile: `temporal-ui`, an optional dashboard, plus its required Temporal services

`daoflow install` uses the lean profile by default. The explicit
`--workflow-profile temporal` option activates the `temporal` profile as well. Temporal UI is
always separate and is not started by either workflow profile.

The `daoflow` service also mounts:

- `/var/run/docker.sock` so the worker can execute local Docker and Compose operations
- `daoflow-staging` for frozen deploy artifacts
- `daoflow-ssh` for managed SSH key material

## Key Compose Excerpt

```yaml
services:
  daoflow:
    image: ghcr.io/daoflow-dev/daoflow:${DAOFLOW_VERSION:-0.10.0}
    ports:
      - "${DAOFLOW_BIND:-127.0.0.1}:${DAOFLOW_PORT:-3000}:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - daoflow-staging:/app/staging
      - daoflow-ssh:/app/.ssh
    environment:
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:3000}
      DAOFLOW_ENABLE_TEMPORAL: ${DAOFLOW_ENABLE_TEMPORAL:-false}
      TEMPORAL_ADDRESS: temporal:7233
      TEMPORAL_NAMESPACE: ${TEMPORAL_NAMESPACE:-daoflow}
      TEMPORAL_TASK_QUEUE: ${TEMPORAL_TASK_QUEUE:-daoflow-deployments}
    healthcheck:
      test: ["CMD-SHELL", "<health endpoint check>"]

  postgres:
    image: pgvector/pgvector:pg17

  redis:
    image: redis:7-alpine

  temporal-postgresql:
    image: postgres:15-alpine
    profiles:
      - temporal
      - temporal-ui

  temporal:
    image: temporalio/auto-setup:1.29.6
    profiles:
      - temporal
      - temporal-ui
    expose:
      - "7233"
    environment:
      DEFAULT_NAMESPACE: ${TEMPORAL_NAMESPACE:-daoflow}

  temporal-ui:
    image: temporalio/ui:2.49.1
    profiles:
      - temporal-ui
    ports:
      - "127.0.0.1:${TEMPORAL_UI_PORT:-8233}:8080"
```

## Environment File

Start from the repository `.env.example` or let `daoflow install` generate it for you. The minimum production values are:

```bash
BETTER_AUTH_SECRET=generate-a-long-random-secret
ENCRYPTION_KEY=generate-at-least-32-char-secret
POSTGRES_PASSWORD=generate-a-secure-password
# TEMPORAL_POSTGRES_PASSWORD=generate-another-secure-password  # temporal profile only
BETTER_AUTH_URL=https://deploy.example.com
DAOFLOW_VERSION=0.10.0
DAOFLOW_BIND=127.0.0.1
DAOFLOW_PORT=3000
DAOFLOW_WORKFLOW_PROFILE=lean
COMPOSE_PROFILES=
DAOFLOW_ENABLE_TEMPORAL=false
```

For an explicit Temporal install, use the following profile settings and provide the Temporal
database password:

```bash
DAOFLOW_WORKFLOW_PROFILE=temporal
COMPOSE_PROFILES=temporal
DAOFLOW_ENABLE_TEMPORAL=true
TEMPORAL_POSTGRES_PASSWORD=generate-another-secure-password
```

Lean can omit `TEMPORAL_POSTGRES_PASSWORD`; the temporal profile requires a non-empty value.

Generate secure values:

```bash
openssl rand -hex 32  # BETTER_AUTH_SECRET
openssl rand -hex 32  # ENCRYPTION_KEY
openssl rand -hex 16  # POSTGRES_PASSWORD / TEMPORAL_POSTGRES_PASSWORD
```

## Local-Source QA Build

Production should normally use a released image. To test an exact local revision on a QA host,
build the application target and give it a revision-specific tag:

```bash
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

The Dockerfile's final target is the development-task runner, not the DaoFlow application. Always
select `--target runtime` for a control-plane image. Build on the QA host, or use Docker Buildx with
the QA host's target platform when the build machine has a different CPU architecture.

Set `DAOFLOW_VERSION` in `.env` to the generated `qa-<revision>` tag and fill every required secret.
For a fresh database, also set both `DAOFLOW_INITIAL_ADMIN_EMAIL` and
`DAOFLOW_INITIAL_ADMIN_PASSWORD`; the server only bootstraps an owner when both values are present.
Pull only the dependency images so Compose does not try to fetch the local-only DaoFlow tag. The
lean QA path needs only PostgreSQL and Redis:

```bash
docker compose pull postgres redis
docker compose up -d --wait --wait-timeout 300
```

For a Temporal QA run, also enable its profile before pulling and starting those services:

```bash
docker compose --profile temporal pull temporal-postgresql temporal
docker compose --profile temporal up -d temporal
docker compose --profile temporal exec -T temporal \
  temporal operator cluster health --address temporal:7233
docker compose up -d --wait --wait-timeout 300 daoflow
```

Record both the full Git revision (`git rev-parse HEAD`) and image tag with the QA result so the
tested source can be reproduced exactly.

## Startup

For the lean profile (`COMPOSE_PROFILES=`), start the base stack:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f daoflow
```

The default lean stack starts only `daoflow`, `postgres`, and `redis`. For a manual Temporal
startup, start Temporal first, verify that the cluster is healthy, and only then start DaoFlow:

```bash
docker compose --profile temporal up -d temporal
docker compose --profile temporal exec -T temporal \
  temporal operator cluster health --address temporal:7233
docker compose up -d --wait --wait-timeout 300 daoflow
```

With `COMPOSE_PROFILES=temporal` in `.env`, keep the same service-specific sequence. Do not run
`docker compose --profile temporal up -d` without a service target because it can start `daoflow`
before the Temporal health check has passed.

The default stack does not expose Temporal UI. If the temporal workflow profile is enabled and you
need the dashboard for operations, start its separate profile locally:

```bash
docker compose --profile temporal-ui up -d temporal-ui
```

Then access it through `http://127.0.0.1:8233` or your chosen `TEMPORAL_UI_PORT`. Do not publish this dashboard directly to the internet.

## Health And Readiness

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

`/health` only reports that the HTTP process is alive. `/ready` reports whether startup checks have completed, including database migrations, initial owner bootstrap, localhost target bootstrap, and worker startup or skip state.

The `daoflow` container healthcheck uses `/ready`, so `docker compose ps` reports unhealthy until startup is safe enough to serve normal app traffic.

## Docker Socket Trust Boundary

The reference stack mounts `/var/run/docker.sock` into the `daoflow` container. This is a high-trust mode: a process with access to that socket can control Docker on the host. Use it only on hosts dedicated to DaoFlow or to workloads you are comfortable letting DaoFlow manage.

For stricter separation, prefer registering remote servers and using SSH-backed Compose execution instead of mounting the local host socket into the control plane. Keep the socket mount only where local Docker execution is an intentional operational choice.

## Workflow Profile Changes

For a first staging rollout, keep the lean profile until:

- the core control-plane stack is healthy
- you have validated deploy, rollback, and backup flows

When you are ready to test durable orchestration, use the installer with an explicit temporal
profile. It persists all three matching settings:

```bash
daoflow install --workflow-profile temporal --yes
```

```bash
DAOFLOW_WORKFLOW_PROFILE=temporal
COMPOSE_PROFILES=temporal
DAOFLOW_ENABLE_TEMPORAL=true
```

The reference stack registers `${TEMPORAL_NAMESPACE:-daoflow}` during Temporal auto-setup so the app and worker can start workflows without manual namespace bootstrapping.

To return to lean, rerun the installer with `--workflow-profile lean`. The installer explains the
transition plan before mutation, stops and removes `temporal` and `temporal-postgresql`, and keeps
the `temporal-pgdata` named volume. Do not use `docker compose down -v`, because it removes named
volumes and defeats that data-preservation guarantee.

## Upgrades And Backups

Keep `DAOFLOW_VERSION` pinned in `.env` for repeatable rollouts. Before upgrading, take a database backup or snapshot the host volumes, then change `DAOFLOW_VERSION`, run `docker compose pull`, and apply the stack with `docker compose up -d`. The installer records the selected version in `.env`; avoid leaving production installs on a floating `latest` tag.
