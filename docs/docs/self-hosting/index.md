---
sidebar_position: 1
---

# Self-Hosting

DaoFlow is designed to run on your own infrastructure. This section covers the current production stack, staging rehearsal, environment configuration, SSL, and incident recovery.

## Quick Start (CLI Installer)

The recommended way to deploy DaoFlow in production:

```bash
# Interactive — prompts for domain, admin email, password
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh

# Non-interactive — fully automated
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- \
  --dir /opt/daoflow \
  --domain deploy.example.com \
  --email admin@example.com \
  --password 'SecureP@ss123' \
  --yes
```

The installer defaults to the lean workflow profile. To include the durable Temporal services,
pass `--workflow-profile temporal` explicitly.

See [Installation](/docs/getting-started/installation) for full details.

Or deploy manually with Docker Compose (see [Docker Compose Setup](./docker-compose)).

## Contents

| Guide                                            | Description                              |
| ------------------------------------------------ | ---------------------------------------- |
| [Requirements](./requirements)                   | Hardware and software prerequisites      |
| [Docker Compose](./docker-compose)               | Production Docker Compose deployment     |
| [Staging Runbook](./staging-runbook)             | Rehearse releases or local source safely |
| [Incident Recovery](./incident-recovery)         | Recover from common operator failures    |
| [Environment Variables](./environment-variables) | All configurable env vars                |
| [SSL & Domains](./ssl-and-domains)               | HTTPS and domain configuration           |
| [Upgrading](./upgrading)                         | Upgrading to new versions                |

## Current Production Topology

The repository production stack is a normal Docker Compose project built from:

1. `daoflow` — web UI, API, and worker entrypoint
2. `postgres` — DaoFlow application database
3. `redis` — streaming and transient coordination
4. `temporal-postgresql`, `temporal` — optional services in the `temporal` Compose profile
5. `temporal-ui` — optional dashboard in its separate `temporal-ui` Compose profile

The default lean install starts only the first three services. The explicit temporal profile adds
the Temporal services and persists `DAOFLOW_WORKFLOW_PROFILE=temporal`, `COMPOSE_PROFILES=temporal`,
and `DAOFLOW_ENABLE_TEMPORAL=true`. Lean persists `DAOFLOW_WORKFLOW_PROFILE=lean`, has no active
Compose profiles, and sets `DAOFLOW_ENABLE_TEMPORAL=false`.

When an existing install is rerun without a profile option, the installer preserves or infers its
current choice. A temporal-to-lean switch explains its plan before mutation, removes the Temporal
containers, and preserves the `temporal-pgdata` named volume. Temporal UI remains separately opt-in.

## Recommended Operator Path

1. Install or copy the reference compose stack
2. Follow the [staging runbook](./staging-runbook) on a non-production host
3. Verify deploy, rollback, backup, and log flows end to end
4. Promote the same operational pattern to production
5. Keep the [incident recovery guide](./incident-recovery) nearby for break-glass situations
