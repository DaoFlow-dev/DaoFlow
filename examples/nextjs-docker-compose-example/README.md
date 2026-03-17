# Next.js Docker Compose Example for DaoFlow

This example demonstrates deploying a Next.js application to DaoFlow using Docker Compose with **local build context**.

When you run `daoflow deploy --compose ./compose.yaml --server <server-id> --yes`, DaoFlow will:

1. **Detect** `build.context: .` in `compose.yaml`
2. **Bundle** the local directory as a tar.gz (respecting `.dockerignore`)
3. **Upload** the context to the DaoFlow server
4. **SCP** the context to your target server
5. **Build** and start containers via `docker compose up -d --build`

## Quick Start

```bash
# Preview what will happen
daoflow deploy --compose ./compose.yaml --server my-server --dry-run

# Deploy
daoflow deploy --compose ./compose.yaml --server my-server --yes
```

## Configuration

This example includes DaoFlow config files in **three formats** — use whichever you prefer:

| File | Format | Status |
|------|--------|--------|
| `daoflow.config.jsonc` | JSONC (with comments) | **Primary** |
| `daoflow.config.yaml` | YAML | Alternative |
| `daoflow.config.toml` | TOML | Alternative |

> **Note:** Only keep one config file in your project. DaoFlow loads the first one found (JSONC → JSON → YAML → TOML).

### JSON Schema

All formats support IDE autocompletion via the JSON Schema:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/packages/cli/daoflow.config.schema.json"
}
```

## Files

```
├── app/
│   ├── layout.tsx       # Next.js root layout
│   └── page.tsx         # Home page
├── compose.yaml         # Docker Compose with build.context: .
├── Dockerfile           # Multi-stage Next.js build
├── .dockerignore        # Standard Docker ignore rules
├── .daoflowignore       # DaoFlow-specific overrides (includes .env)
├── daoflow.config.jsonc # DaoFlow CLI config (primary)
├── daoflow.config.yaml  # DaoFlow CLI config (alternative)
├── daoflow.config.toml  # DaoFlow CLI config (alternative)
├── next.config.js       # Next.js standalone output
└── package.json
```

## How .daoflowignore Works

`.dockerignore` excludes files from the build context (e.g., `node_modules`, `.env`).

`.daoflowignore` lets you **override** `.dockerignore` for files needed at build time:

```
# .daoflowignore
# Lines starting with ! force-include files excluded by .dockerignore
!.env
!.env.production
```

This is useful when your Dockerfile copies `.env` files during the build stage.
