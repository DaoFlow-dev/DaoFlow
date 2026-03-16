---
sidebar_position: 2
---

# Requirements

## Hardware

| Resource | Minimum                          | Recommended        |
| -------- | -------------------------------- | ------------------ |
| CPU      | 1 vCPU                           | 2+ vCPU            |
| RAM      | 1 GB                             | 2+ GB              |
| Disk     | 10 GB                            | 20+ GB             |
| Network  | Public IP or Tailscale/CF Tunnel | Static IP with DNS |

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

## Database

DaoFlow uses PostgreSQL 17 with the pgvector extension for future embedding features. The database should be backed up independently.
