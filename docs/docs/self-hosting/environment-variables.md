---
sidebar_position: 4
---

# Environment Variables

Complete reference for all DaoFlow environment variables.

## Required

| Variable             | Description                              | Example                                     |
| -------------------- | ---------------------------------------- | ------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string             | `postgresql://daoflow:pass@db:5432/daoflow` |
| `REDIS_URL`          | Redis connection string                  | `redis://redis:6379`                        |
| `BETTER_AUTH_SECRET` | Session signing secret (min 32 chars)    | `openssl rand -hex 32`                      |
| `BETTER_AUTH_URL`    | Public URL of DaoFlow instance           | `https://deploy.example.com`                |
| `ENCRYPTION_KEY`     | Secret encryption key (exactly 32 chars) | `openssl rand -hex 16`                      |

## Server

| Variable    | Default       | Description                       |
| ----------- | ------------- | --------------------------------- |
| `PORT`      | `3000`        | HTTP server port                  |
| `NODE_ENV`  | `development` | `production` for prod deployments |
| `LOG_LEVEL` | `info`        | `debug`, `info`, `warn`, `error`  |

## Private Access

| Variable            | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `TAILSCALE_AUTHKEY` | Tailscale auth key — DaoFlow joins your tailnet automatically |
| `CF_TUNNEL_TOKEN`   | Cloudflare Tunnel token — secure access without public IP     |

## Backup Storage (S3)

| Variable        | Description                |
| --------------- | -------------------------- |
| `S3_ENDPOINT`   | S3-compatible endpoint URL |
| `S3_BUCKET`     | Bucket name for backups    |
| `S3_ACCESS_KEY` | S3 access key              |
| `S3_SECRET_KEY` | S3 secret key              |
| `S3_REGION`     | AWS region (optional)      |

## Email (SMTP)

| Variable        | Description              |
| --------------- | ------------------------ |
| `SMTP_HOST`     | SMTP server hostname     |
| `SMTP_PORT`     | SMTP port (default: 587) |
| `SMTP_USER`     | SMTP username            |
| `SMTP_PASSWORD` | SMTP password            |
| `SMTP_FROM`     | From address for emails  |

## Security

| Variable            | Default   | Description                             |
| ------------------- | --------- | --------------------------------------- |
| `SESSION_MAX_AGE`   | `86400`   | Session lifetime in seconds (24h)       |
| `TOKEN_MAX_AGE`     | `7776000` | API token max lifetime in seconds (90d) |
| `RATE_LIMIT_WINDOW` | `60`      | Rate limit window in seconds            |
| `RATE_LIMIT_MAX`    | `100`     | Max requests per window                 |
