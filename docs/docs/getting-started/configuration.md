---
sidebar_position: 4
---

# Configuration

DaoFlow is configured through environment variables and a CLI config file.

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `BETTER_AUTH_SECRET` | Session signing secret (min 32 characters) |
| `BETTER_AUTH_URL` | Public-facing URL of the DaoFlow instance |
| `ENCRYPTION_KEY` | Encryption key for secrets storage (exactly 32 characters) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `TAILSCALE_AUTHKEY` | — | Tailscale auth key for private network access |
| `CF_TUNNEL_TOKEN` | — | Cloudflare Tunnel token for secure access without public IP |
| `S3_ENDPOINT` | — | S3-compatible endpoint for backup storage |
| `S3_BUCKET` | — | S3 bucket name for backups |
| `S3_ACCESS_KEY` | — | S3 access key |
| `S3_SECRET_KEY` | — | S3 secret key |

### Private Access (Tailscale / Cloudflare Tunnel)

DaoFlow supports private access without exposing a public URL:

```bash
# Tailscale — connect via your tailnet
TAILSCALE_AUTHKEY=tskey-auth-xxx

# Cloudflare Tunnel — expose via Cloudflare's edge network
CF_TUNNEL_TOKEN=eyJ...
```

When either variable is set, DaoFlow will automatically configure the tunnel on startup.

## CLI Configuration

The CLI stores its configuration in `~/.daoflow/config.json`:

```json
{
  "apiUrl": "http://localhost:3000",
  "token": "your-api-token",
  "defaultProject": "my-web-app",
  "defaultEnvironment": "production",
  "defaultServer": "my-vps"
}
```

### Setting CLI Defaults

```bash
# Set the API URL
daoflow login --url https://your-instance.com --token YOUR_TOKEN

# Set default project context
daoflow config set defaultProject my-web-app
daoflow config set defaultServer my-vps
```

## Server Configuration

Each registered server has configurable settings:

| Setting | Default | Description |
|---------|---------|-------------|
| SSH Host | — | IP address or hostname |
| SSH Port | `22` | SSH port |
| SSH Key | — | Path to SSH private key |
| Health Check Interval | `60s` | How often to check server health |
| Docker Socket | `/var/run/docker.sock` | Docker socket path |

## Security Configuration

See the [Security & RBAC guide](/docs/security) for configuring:
- User roles and permissions
- API token scopes
- Agent principal accounts
- Audit log retention
