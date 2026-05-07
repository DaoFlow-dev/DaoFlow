---
sidebar_position: 6
---

# Upgrading

How to upgrade DaoFlow to a new version.

## Docker Compose Upgrade

```bash
# Pull the latest image
docker compose pull

# Restart with the new version
docker compose up -d

# Check process health and startup readiness
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

DaoFlow automatically runs required database migrations before the HTTP server starts accepting traffic. In production, a migration failure stops startup by default instead of serving requests against an incompatible schema.

If you want to run migrations as an explicit preflight without starting the web server:

```bash
docker compose run --rm -e DAOFLOW_RUN_MIGRATIONS_ONLY=true daoflow
```

Use `DAOFLOW_ALLOW_START_WITH_MIGRATION_FAILURE=true` only as an emergency operator bypass. With that flag set, the process may continue after migration failure, but `/ready` stays unavailable and the container healthcheck remains unhealthy.

## Checking Status And Version

```bash
# Via API status
curl http://localhost:3000/trpc/health | jq '.result.data.json'

# Via CLI
daoflow --cli-version
```

## Backup Before Upgrading

Always back up your database before major upgrades:

```bash
docker compose exec db pg_dump -U daoflow daoflow > backup-$(date +%Y%m%d).sql
```

## Rollback

If an upgrade fails:

```bash
# Stop the new version
docker compose down

# Restore the database backup
docker compose up -d db
docker compose exec -T db psql -U daoflow daoflow < backup-20260315.sql

# Start the previous version
docker compose up -d
```

## Version Pinning

For production stability, pin to a specific version:

```yaml
services:
  daoflow:
    image: ghcr.io/daoflow-dev/daoflow:v0.1.0 # pinned
```

## Changelog

See the [GitHub Releases](https://github.com/DaoFlow-dev/DaoFlow/releases) for what changed in each version.
