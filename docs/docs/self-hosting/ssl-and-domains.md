---
sidebar_position: 5
---

# SSL & Domains

DaoFlow supports HTTPS through an external reverse proxy, Cloudflare Tunnel, Tailscale, or the built-in Traefik option in `daoflow install`.

## Service Domain Workflows

The Service Detail Domains tab now persists desired hostnames and explicit published port mappings
per service. DaoFlow also compares those desired hostnames against observed tunnel or reverse-proxy
routes so operators can see whether a domain is matched, missing, inactive, or conflicting.

What DaoFlow does today:

- Can bootstrap Traefik for the DaoFlow dashboard during installation, including automatic Let's Encrypt certificates
- Stores service-level custom domains and primary-domain selection
- Stores explicit port-mapping metadata that operators want to keep outside the source compose file
- Shows observed route and route-backed TLS readiness based on existing tunnel or proxy state
- Can opt individual service domains into DaoFlow-managed Traefik routing for Compose deployments

What stays operator-controlled:

- DNS still needs to point each managed hostname at the target server before Let's Encrypt can issue certificates
- DaoFlow does not manage Caddy or Nginx rules
- Certificate readiness is tracked separately from observed tunnel status

Unmanaged domains still use the observation workflow: point your reverse proxy or tunnel at the
published service entrypoint, then return to the Domains tab to confirm DaoFlow sees the route.
Managed Traefik domains are rendered into the deployment's Compose file when the target server has
a managed proxy configuration.

## Option 1: Reverse Proxy (Recommended)

Use Nginx, Caddy, or Traefik as a reverse proxy with automatic SSL.

### Built-in Traefik for the Dashboard

If you want DaoFlow to stand up its own reverse proxy for the control plane, use the installer:

```bash
daoflow install \
  --domain deploy.example.com \
  --expose traefik \
  --acme-email ops@example.com
```

This keeps the DaoFlow app itself on its local port and publishes HTTPS on ports 80/443 through Traefik. Your DNS still needs to point the chosen hostname at the server before Let's Encrypt can succeed.

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

### Traefik for Additional Services

For services beyond the DaoFlow dashboard, DaoFlow can now render Traefik labels and attach the
Compose service to an external proxy network. Configure the target server once:

```bash
daoflow server proxy \
  --server srv_prod \
  --network daoflow-proxy \
  --entrypoint websecure \
  --cert-resolver letsencrypt \
  --dns-target 203.0.113.10 \
  --yes
```

Then switch a service domain from observation to managed Traefik:

```bash
daoflow services domain routing \
  --service svc_api \
  --domain dom_app \
  --mode managed-traefik \
  --target-port 3000 \
  --yes
```

Deployment plans show the generated route intent and fail preflight when the proxy configuration,
target port, DNS expectation, or server target is not ready. During execution DaoFlow adds labels
equivalent to:

```yaml
services:
  my-custom-service:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.custom-service.rule=Host(`app.example.com`)"
      - "traefik.http.routers.custom-service.tls.certresolver=letsencrypt"
    networks:
      - daoflow-proxy

networks:
  daoflow-proxy:
    external: true
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
