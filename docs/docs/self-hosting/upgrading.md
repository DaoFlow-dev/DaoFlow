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

# Check health
curl http://localhost:3000/trpc/healthCheck
```

DaoFlow automatically runs database migrations on startup.

## Checking Your Version

```bash
# Via API
curl http://localhost:3000/trpc/healthCheck | jq '.result.data.json.version'

# Via CLI
daoflow --version
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
    image: ghcr.io/daoflow/daoflow:v0.1.0  # pinned
```

## Changelog

See the [GitHub Releases](https://github.com/daoflow/daoflow/releases) for what changed in each version.
