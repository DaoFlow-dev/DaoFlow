# @daoflow/shared — Agent Rules

## Purpose

This package is the shared dependency layer. It must remain side-effect free and import nothing from `@daoflow/server` or `@daoflow/client`.

## Rules

- All exports must go through `src/index.ts` barrel file.
- Zod schemas define the contract between server and client.
- Use Zod v4 API. Do not import from `zod/v3` or similar.
- Keep this package minimal — only shared types and validation.
- No runtime dependencies other than `zod`.
- Run `bun run typecheck` before committing.
