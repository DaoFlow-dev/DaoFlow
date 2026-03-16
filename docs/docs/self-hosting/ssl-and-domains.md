---
sidebar_position: 5
---

# SSL & Domains

DaoFlow supports HTTPS via reverse proxy or Cloudflare Tunnel.

## Option 1: Reverse Proxy (Recommended)

Use Nginx, Caddy, or Traefik as a reverse proxy with automatic SSL.

### Caddy (Easiest)

```
deploy.example.com {
    reverse_proxy localhost:3000
}
```

Caddy automatically provisions and renews Let's Encrypt certificates.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name deploy.example.com;

    ssl_certificate /etc/letsencrypt/live/deploy.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/deploy.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Traefik

Add labels to your DaoFlow service in `compose.yaml`:

```yaml
services:
  daoflow:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.daoflow.rule=Host(`deploy.example.com`)"
      - "traefik.http.routers.daoflow.tls.certresolver=letsencrypt"
```

## Option 2: Cloudflare Tunnel

No public IP or SSL setup needed:

```bash
CF_TUNNEL_TOKEN=eyJ...your-tunnel-token
```

DaoFlow automatically connects to the Cloudflare edge.

## Option 3: Tailscale

Access DaoFlow via your tailnet (private network):

```bash
TAILSCALE_AUTHKEY=tskey-auth-xxx
```

No SSL needed — Tailscale handles encryption.

## DNS Setup

Point your domain to your server's IP address:

```
deploy.example.com  A  203.0.113.10
```

Update `BETTER_AUTH_URL` to match:

```bash
BETTER_AUTH_URL=https://deploy.example.com
```
