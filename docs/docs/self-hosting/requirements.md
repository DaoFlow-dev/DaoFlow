---
sidebar_position: 2
---

# Requirements

## Hardware

DaoFlow does not publish a universal minimum for either workflow profile. Until a final build is
linked to reproducible constrained-host evidence, use the conservative production starting points
below and rehearse your own workload on staging. The QA targets describe the acceptance runs used to
evaluate smaller hosts; they are not capacity promises.

| Workflow profile    | Services                                             | Conservative production starting point | Constrained QA target                   | Free disk |
| ------------------- | ---------------------------------------------------- | -------------------------------------- | --------------------------------------- | --------- |
| Lean (default)      | `daoflow`, `postgres`, `redis`                       | 2 vCPU / 4 GiB RAM                     | 1 vCPU / 1 GiB RAM, no swap             | 30 GB     |
| Temporal (explicit) | Lean services plus `temporal-postgresql`, `temporal` | 4 vCPU / 8 GiB RAM                     | 2 vCPU / 4 GiB RAM, exact worker health | 50 GB     |

Image builds, concurrent deployments, application containers, logs, backup retention, and Temporal
workflow history all increase required capacity. The separate `temporal-ui` profile is optional and
should be included in sizing when enabled. Final measured results belong in a repository evidence
record that names the tested commit and image tag and excludes private QA host details.

| Network | Interim requirement                      | Preferred          |
| ------- | ---------------------------------------- | ------------------ |
| Access  | Public IP or Tailscale/Cloudflare Tunnel | Static IP with DNS |

## Software

| Software       | Version                                                           |
| -------------- | ----------------------------------------------------------------- |
| Linux          | Ubuntu 22.04+, Debian 12+, Rocky 9+, or any Docker-capable distro |
| Docker Engine  | 20.10+                                                            |
| Docker Compose | v2.0+                                                             |

macOS is supported for development but not recommended for production.

## Managed Servers

Each server you deploy to needs:

- SSH access with key-based authentication
- Docker Engine 20.10+ installed
- Docker Compose v2+ installed
- User in the `docker` group (or sudo access)
- Outbound internet for pulling images (or a local registry)

## Ports

| Port | Service              | Default                         |
| ---- | -------------------- | ------------------------------- |
| 3000 | DaoFlow web UI + API | Configurable via `PORT` env var |
| 5432 | PostgreSQL           | Internal only                   |
| 6379 | Redis                | Internal only                   |
| 7233 | Temporal             | Internal only, temporal profile |
| 8233 | Temporal UI          | Localhost only, separate opt-in |

## Database

DaoFlow uses PostgreSQL 17 with the pgvector extension for future embedding features. The database
should be backed up independently. Stopping or switching profiles does not by itself delete named
volumes; explicit data-removal commands are destructive and should follow a verified backup.
