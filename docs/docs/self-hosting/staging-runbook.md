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

If you prefer manual control, use the repository production `docker-compose.yml` plus the generated `.env.example` as described in [Docker Compose Setup](./docker-compose).

## 3. Review The Generated `.env`

Before the first rehearsal, confirm at least:

- `BETTER_AUTH_URL` points at your staging origin
- `DAOFLOW_VERSION` is pinned to the release you want to rehearse
- `DAOFLOW_ENABLE_TEMPORAL=false` for the first pass unless you specifically want to test Temporal
- `POSTGRES_PASSWORD` and `TEMPORAL_POSTGRES_PASSWORD` are non-empty

## 4. Verify The Control Plane

```bash
cd /opt/daoflow-staging
docker compose ps
docker compose logs --tail=200 daoflow
curl http://127.0.0.1:3000/trpc/health
```

Expected result:

- `daoflow`, `postgres`, `redis`, and Temporal services are running
- the health endpoint responds
- the UI loads and you can sign in as the initial owner

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

## 9. Optional: Enable Temporal

After the baseline rehearsal is green, you can exercise durable orchestration:

```bash
cd /opt/daoflow-staging
sed -i.bak 's/^#\\?DAOFLOW_ENABLE_TEMPORAL=.*/DAOFLOW_ENABLE_TEMPORAL=true/' .env
docker compose up -d daoflow
docker compose logs --tail=200 daoflow temporal temporal-ui
```

Keep the fallback in mind: if Temporal mode is unstable, set `DAOFLOW_ENABLE_TEMPORAL=false` and restart `daoflow` to return to the legacy worker.

## Exit Checklist

- Control plane healthy after restart
- Owner sign-in works
- Managed target reachable over SSH
- At least one deployment dry-run and one real deployment succeed
- Deployment logs visible through UI or `daoflow logs --deployment`
- Rollback targets discoverable
- Backup run and verify workflow exercised
- Incident recovery guide reviewed by the operator on call
