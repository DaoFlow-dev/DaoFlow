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

## Explicit Bootstrap Flow

```bash
daoflow projects create --name myapp --yes
daoflow projects env create --project <project-id> --name production --yes
daoflow services create --project <project-id> --environment <environment-id> --name web --source-type image --image ghcr.io/acme/myapp:latest --yes
daoflow plan --service <service-id>
daoflow deploy --service <service-id> --yes
```

Use `--source-type compose --compose-service <name>` for Compose-backed services or `--source-type dockerfile --dockerfile <path>` for Dockerfile-backed services.

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

## System requirements for compiled binaries

The Bun-compiled CLI binary has two host-level requirements that must both be met:

1. **CPU with AVX2 support** (or SSE4.2 minimum for the baseline build).
   KVM/QEMU virtual machines often default to a generic CPU model that lacks AVX.
   Fix: set the VM CPU type to `host` passthrough so the guest can use the
   physical CPU's instruction sets.

2. **Swap space on hosts with ≤ 8 GB RAM.**
   Bun reserves a large virtual address space (~91 GB) at startup and peaks at
   ~7.4 GB RSS. Without swap the Linux OOM killer will terminate the process
   before it can run any command.

   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

Both issues must be resolved together — AVX alone won't help if OOM kills the
process, and swap alone won't help if the CPU faults on an unsupported
instruction.

## Scripts

```bash
bun run dev        # Run CLI from source
bun run typecheck  # tsc --noEmit
```
