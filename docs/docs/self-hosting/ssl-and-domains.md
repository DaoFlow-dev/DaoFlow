---
sidebar_position: 5
---

# SSL & Domains

DaoFlow supports HTTPS via reverse proxy or Cloudflare Tunnel.

## Service Domain Workflows

The Service Detail Domains tab now persists desired hostnames and explicit published port mappings
per service. DaoFlow also compares those desired hostnames against observed tunnel or reverse-proxy
routes so operators can see whether a domain is matched, missing, inactive, or conflicting.

What DaoFlow does today:

- Stores service-level custom domains and primary-domain selection
- Stores explicit port-mapping metadata that operators want to keep outside the source compose file
- Shows observed route and route-backed TLS readiness based on existing tunnel or proxy state

What DaoFlow does not do from that tab:

- Automatically provision Traefik, Caddy, or Nginx rules for you
- Mint or inspect certificates directly outside the route state it can already observe

You still need to point your reverse proxy or tunnel at the correct published service entrypoint.
Once that external routing is in place, the Domains tab reflects the observed state.

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

No public IP or reverse-proxy VM is required, but the tunnel itself is still external to DaoFlow.

For temporary public access, `daoflow install --expose cloudflare-quick` can start a Cloudflare Quick Tunnel and rewrite `BETTER_AUTH_URL` to the generated `trycloudflare.com` URL.

For a stable Cloudflare-managed hostname, run `cloudflared` separately and point it at the DaoFlow host:

```bash
cloudflared tunnel run <your-tunnel-name>
```

Then set `BETTER_AUTH_URL` to the public origin exposed by Cloudflare.

## Option 3: Tailscale

DaoFlow does not join the tailnet automatically; install and authorize Tailscale on the host separately.

The installer can bootstrap two Tailscale exposure modes:

- `daoflow install --expose tailscale-serve` for a tailnet-only HTTPS URL
- `daoflow install --expose tailscale-funnel` for a public HTTPS URL

Both modes update `BETTER_AUTH_URL` to the Tailscale URL that serves the dashboard.

## DNS Setup

Point your domain to your server's IP address:

```
deploy.example.com  A  203.0.113.10
```

Update `BETTER_AUTH_URL` to match:

```bash
BETTER_AUTH_URL=https://deploy.example.com
```
