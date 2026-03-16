# Next.js + DaoFlow Example

A minimal Next.js application pre-configured for deployment via DaoFlow.

## Deploy with DaoFlow

```bash
# Login to your DaoFlow instance
daoflow login --api-url http://localhost:3000 --token YOUR_TOKEN

# Deploy this app (compose-based)
daoflow deploy --compose ./docker-compose.yml --server my-server --yes

# Check status
daoflow status --json
```

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

## What's Included

- `Dockerfile` — Multi-stage build optimized for production
- `docker-compose.yml` — Compose spec for DaoFlow deployment
- `.dockerignore` — Keeps images small
- `.gitignore` — Standard Next.js ignores
