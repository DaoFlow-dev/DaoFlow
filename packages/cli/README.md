# @daoflow/cli

Command-line interface for interacting with the DaoFlow control plane API.

## Stack

- **Runtime**: Bun
- **CLI framework**: Commander.js
- **HTTP client**: Custom fetch-based API client
- **Styling**: chalk + ora (spinners)
- **Container**: dockerode

## Commands

| Command            | Description                       |
| ------------------ | --------------------------------- |
| `daoflow login`    | Authenticate with the DaoFlow API |
| `daoflow services` | List deployed services            |
| `daoflow deploy`   | Queue a deployment                |
| `daoflow push`     | Push a Docker image               |
| `daoflow env`      | Manage environment variables      |
| `daoflow logs`     | Stream deployment logs            |
| `daoflow plan`     | Generate deployment plan          |
| `daoflow rollback` | Rollback a deployment             |
| `daoflow status`   | Show service/deployment status    |

## Key files

| Path                | Purpose                             |
| ------------------- | ----------------------------------- |
| `src/index.ts`      | CLI entry point (Commander setup)   |
| `src/api-client.ts` | HTTP client for DaoFlow API         |
| `src/config.ts`     | Config file management (~/.daoflow) |
| `src/commands/`     | Individual command implementations  |

## Binary builds

```bash
bun run build         # Current platform → dist/daoflow
bun run build:linux   # Linux x64 → dist/daoflow-linux-x64
bun run build:mac     # macOS ARM64 → dist/daoflow-darwin-arm64
```

Built binaries are self-contained (Bun runtime embedded). No Node.js required.

## Scripts

```bash
bun run dev        # Run CLI from source
bun run typecheck  # tsc --noEmit
```
