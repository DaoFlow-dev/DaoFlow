---
sidebar_position: 5
---

# Incident Recovery

This page is the operator playbook for the most common DaoFlow failures.

## First Five Minutes

Collect the state before you make changes:

```bash
cd /opt/daoflow
docker compose ps
docker compose logs --tail=200 daoflow
docker compose logs --tail=100 postgres redis temporal temporal-ui
curl http://127.0.0.1:3000/trpc/health
```

If the web UI is reachable, also capture:

- the failing deployment or backup run ID
- the server name involved
- the last successful deployment or backup before the incident
- the deployment state artifact export from the deployment details panel

## Control Plane Will Not Start

Check:

1. `.env` contains non-empty `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, and `TEMPORAL_POSTGRES_PASSWORD`
2. `BETTER_AUTH_URL` matches the public origin operators are actually using
3. `/var/run/docker.sock` is mounted into the `daoflow` container
4. `postgres` is healthy before `daoflow` starts

Useful commands:

```bash
docker compose logs --tail=200 daoflow
docker compose logs --tail=200 postgres
```

If startup fails during owner bootstrap, correct the `DAOFLOW_INITIAL_ADMIN_*` values and restart `daoflow`.

## Deployments Fail Or Stall

Use the deployment ID from the dashboard or CLI response:

```bash
daoflow logs --deployment <deployment-id> --json
daoflow status --json
daoflow doctor --json
```

Check:

- target server SSH connectivity
- Docker and Docker Compose availability on the managed host
- whether the Compose deploy required a context upload and that the staging workspace is writable
- whether the failure is in plan generation, artifact staging, Docker execution, or post-start health
- whether the dashboard deployment details show a difference between declared config, frozen deployment input, and last observed live state

From the dashboard:

1. open the failed service or deployment record
2. expand the deployment details
3. copy or download the deployment state artifact JSON
4. compare the frozen deployment input with the live runtime section before changing anything

If Temporal mode is enabled, also inspect:

```bash
docker compose logs --tail=200 temporal temporal-ui daoflow
```

Emergency fallback:

1. set `DAOFLOW_ENABLE_TEMPORAL=false` in `.env`
2. `docker compose up -d daoflow`

That returns the system to the legacy in-process worker while you investigate Temporal separately.

## Backups Fail

```bash
daoflow backup list --json
daoflow backup destination test --id <destination-id>
daoflow backup run --policy <policy-id> --yes
```

Most backup failures reduce to one of:

- destination credentials or bucket and path permissions
- SSH or Docker access to the target host
- not enough disk space in the staging or destination path

Failed backup runs are preserved as first-class records. Do not delete them until you have captured their error detail.

## Restore Or Verification Fails

```bash
daoflow backup restore --backup-run-id <run-id> --yes
daoflow backup verify --backup-run-id <run-id> --yes
daoflow backup download --backup-run-id <run-id> --json
```

Current product behavior is artifact-oriented:

- restore requests resolve the backup run and download the artifact from the configured destination
- success or failure is recorded in restore metadata, audit entries, and events
- application-specific volume or database rehydration may still require manual operator steps

If you need manual recovery today:

1. use `daoflow backup download --backup-run-id <run-id> --json` to discover the artifact path
2. use your storage backend tooling or `rclone` to fetch the artifact
3. restore the data with the application or database-specific procedure
4. record the manual action in your incident notes

## Compose State Recovery

When a Compose-backed service looks wrong but the host is still reachable:

1. open the service `Compose` tab to copy or download the DaoFlow-managed override layer
2. open the latest deployment details and export the deployment state artifact JSON
3. compare the declared config, frozen deployment input, and live runtime sections
4. only then fall back to host-level `docker compose ps`, `docker inspect`, or manual file inspection

This keeps DaoFlow Compose-first while still giving operators a visible escape hatch into the exact state the control plane believes it manages.

## Upgrade Regression

If a newly pulled DaoFlow image regresses:

1. pin `DAOFLOW_VERSION` back to the previous known-good tag
2. `docker compose pull && docker compose up -d`
3. if the database schema changed incompatibly, restore your pre-upgrade database backup before bringing the older image back online

See [Upgrading](./upgrading) for the normal upgrade path.

## Escalation Checklist

- Captured `docker compose ps`
- Captured logs from `daoflow` and the affected dependency
- Recorded the failing deployment, backup, or restore ID
- Confirmed whether Temporal mode was enabled
- Verified whether the incident is control-plane-local or remote-target-specific
