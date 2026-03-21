---
sidebar_position: 5
---

# `daoflow templates`

`daoflow templates` is the curated app-template catalog for operators and agents who want a normal DaoFlow Compose plan without hand-writing the initial compose file.

The catalog is shipped with the CLI and dashboard. Today it includes representative:

- databases: PostgreSQL
- cache and queue services: Redis, RabbitMQ
- applications: n8n, Uptime Kuma

Each template carries structured metadata for:

- parameterized fields
- secret inputs
- domain inputs
- named volumes
- health-check expectations

## Key Principle

Templates do **not** introduce a second deployment system.

`plan` renders a template into a standard direct Compose deployment plan, and `apply` queues the same `/api/v1/deploy/compose` workflow DaoFlow already uses for direct stack deploys.

## List Templates

```bash
daoflow templates list
daoflow templates list --json
```

This is a local catalog read and does not require API access.

## Inspect A Template

```bash
daoflow templates show postgres
daoflow templates show n8n --json
```

`show` returns the template metadata: services, required fields, volumes, and health checks.

## Preview A Template Deployment

```bash
daoflow templates plan postgres \
  --server srv_db_1 \
  --project-name analytics-db \
  --set postgres_db=analytics \
  --set postgres_user=analytics \
  --set postgres_password=replace-me
```

This uses the normal planning lane and requires `deploy:read`.

You receive a regular Compose deployment plan, including:

- whether DaoFlow will create or reuse the project, environment, and service scope
- the target server and rollout mode
- pre-flight checks
- the final execute command

## Apply A Template

```bash
daoflow templates apply n8n \
  --server srv_apps_1 \
  --project-name team-automation \
  --set n8n_domain=n8n.example.com \
  --set n8n_encryption_key=replace-me \
  --yes
```

This queues a normal direct Compose deployment and requires `deploy:start`.

`apply` keeps the usual DaoFlow write guardrails:

- `--yes` is required
- `--idempotency-key` is forwarded on the write request
- `--json` returns a structured success envelope with the deployment ID

## Input Rules

- Template overrides use repeated `--set key=value`
- Unknown keys fail fast
- Required fields must be present
- Port fields must be valid TCP ports
- Domain fields must be bare `host` or `host:port` values

Secret fields are masked in CLI output, but the real values are rendered into the queued compose payload.
