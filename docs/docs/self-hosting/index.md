---
sidebar_position: 1
---

# Self-Hosting

DaoFlow is designed to run on your own infrastructure. This section covers production deployment requirements, Docker Compose setup, environment configuration, SSL, and upgrades.

## Quick Start

```bash
curl -sSL https://get.daoflow.dev | sh
```

Or deploy manually with Docker Compose (see [Docker Compose Setup](./docker-compose)).

## Contents

| Guide | Description |
|-------|-------------|
| [Requirements](./requirements) | Hardware and software prerequisites |
| [Docker Compose](./docker-compose) | Production Docker Compose deployment |
| [Environment Variables](./environment-variables) | All configurable env vars |
| [SSL & Domains](./ssl-and-domains) | HTTPS and domain configuration |
| [Upgrading](./upgrading) | Upgrading to new versions |

## Architecture

In production, DaoFlow runs as three services:

1. **DaoFlow app** — API server + web dashboard
2. **PostgreSQL 17** — persistent state
3. **Redis 7** — background jobs and real-time streaming

## Private Access

DaoFlow supports private access via Tailscale or Cloudflare Tunnel:

```bash
# Tailscale — no public IP needed
TAILSCALE_AUTHKEY=tskey-auth-xxx

# Cloudflare Tunnel — secure access via Cloudflare edge
CF_TUNNEL_TOKEN=eyJ...
```
