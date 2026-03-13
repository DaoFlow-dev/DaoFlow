# @daoflow/shared

Shared types, Zod schemas, and constants used by both server and client packages.

## Stack

- **Validation**: Zod v4
- **Language**: TypeScript 5.9

## Key files

| Path               | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `src/index.ts`     | Main export barrel                                  |
| `src/schemas/`     | Zod schemas shared between server router and client |
| `src/constants.ts` | Shared constants (roles, capabilities, etc.)        |

## Scripts

```bash
bun run typecheck  # tsc --noEmit
```

## Usage

Both `@daoflow/server` and `@daoflow/client` depend on this package via `workspace:*`.
