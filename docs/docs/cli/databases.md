---
sidebar_position: 5
---

# Databases

`daoflow databases` manages first-class database services without hand-writing Compose. Database services still deploy through DaoFlow's normal Docker and Compose execution path, so plans, deployments, logs, health, audit entries, volumes, and backups stay attached to the same service record.

Supported engines:

- `postgres`
- `mysql`
- `mariadb`
- `mongo`
- `redis`

## List

```bash
daoflow databases list
daoflow databases list --json
```

The list output shows only services created or marked as managed databases. Connection strings are always masked.

## Show

```bash
daoflow databases show --service svc_123
daoflow databases show --service svc_123 --json
```

The detail output shows the engine, database name, user, published port, persistent volume, linked backup policy, internal URI, and published URI. Passwords are never printed.

## Create

```bash
daoflow databases create \
  --kind postgres \
  --project proj_123 \
  --environment production \
  --server srv_123 \
  --name app-db \
  --database app \
  --user app \
  --password-env APP_DB_PASSWORD \
  --yes
```

Creation renders a curated Compose starter, stores masked database metadata on the service, registers the persistent volume, creates a backup policy, and queues the first deployment.

Use `--dry-run --json` to inspect the request shape before mutating:

```bash
daoflow databases create \
  --kind mysql \
  --project proj_123 \
  --environment production \
  --server srv_123 \
  --password-env MYSQL_PASSWORD \
  --root-password-env MYSQL_ROOT_PASSWORD \
  --dry-run \
  --json
```

Passwords can be supplied through one source only:

- `--password <value>`
- `--password-env <name>`
- `--password-file <path>`

Root passwords use the matching `--root-password`, `--root-password-env`, and `--root-password-file` flags. Missing environment variables fail fast instead of silently creating an unintended generated password.

## Lifecycle

```bash
daoflow databases start --service svc_123 --yes
daoflow databases restart --service svc_123 --yes
daoflow databases stop --service svc_123 --yes
```

`start` and `restart` queue the normal Compose `up` path. `stop` queues Compose `down`. Use `--dry-run --json` to preview the lifecycle request without mutating.

## Delete

```bash
daoflow databases delete --service svc_123 --yes
```

Delete removes the managed database service record. Stop the database first when the running Compose stack should be brought down before removing the record.
