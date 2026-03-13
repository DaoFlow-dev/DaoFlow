# @daoflow/cli — Agent Rules

## Build

- Run `bun run typecheck` before committing.
- Build binaries with `bun run build` (or platform-specific variants).
- Built binaries go to `dist/` which is gitignored.
- Test compiled binary: `./dist/daoflow --help`.

## Commands

- Each command lives in `src/commands/<name>.ts`.
- Commands export a factory function returning a `Command` instance.
- Always handle errors gracefully with user-friendly messages via `chalk.red()`.
- Use `ora` spinners for long-running operations.

## API Client

- `src/api-client.ts` wraps `fetch()` for the DaoFlow API.
- Auth tokens are stored via `src/config.ts` in `~/.daoflow/config.json`.
- Always include error handling for network failures and auth expiry.

## Code Style

- Use `import type` for type-only imports.
- Prefer `commander`'s built-in argument parsing over manual `process.argv`.
- Keep commands focused — one responsibility per command file.
- Use structured output (tables, JSON) that agents can parse.
