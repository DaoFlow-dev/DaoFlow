---
sidebar_position: 5
---

# Code Style

Conventions and formatting standards for the DaoFlow codebase.

## TypeScript

- **Strict mode** enabled (`strict: true` in tsconfig)
- Use `const` by default, `let` only when reassignment is needed
- Prefer `type` over `interface` for simple shapes
- Use Zod for runtime validation of API inputs
- Prefer early returns over deeply nested conditionals

## Naming

| Entity           | Convention       | Example            |
| ---------------- | ---------------- | ------------------ |
| Files            | kebab-case       | `api-client.ts`    |
| Variables        | camelCase        | `deploymentRecord` |
| Types            | PascalCase       | `DeploymentStatus` |
| Constants        | UPPER_SNAKE_CASE | `MAX_RETRIES`      |
| Database columns | snake_case       | `created_at`       |
| API scopes       | colon-delimited  | `deploy:start`     |

## File Organization

- One component per file
- Co-locate tests with source (`foo.ts` → `foo.test.ts`)
- Group related files in directories
- Keep imports organized: external → internal → relative

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cli): add whoami command
fix(server): correct token scope enforcement
refactor(shared): align authz scopes to AGENTS.md
docs: add deployment guide
test(e2e): add auth flow tests
chore: update dependencies
```

**Scopes:** `server`, `client`, `cli`, `shared`, `docs`, `e2e`

## Code Review

- All changes require a pull request
- At least one review approval required
- CI must pass before merging
- Squash merge for feature branches
- Keep commits atomic — one logical change per commit

## Formatting

```bash
# Lint
bun run lint

# Fix auto-fixable issues
bun run lint --fix
```

## Database

- Use Drizzle ORM for all database operations
- All tables need `created_at` and `updated_at` timestamps
- Use migrations for schema changes (`bun run db:migrate`)
- Index frequently queried columns
- Use JSON columns for flexible metadata
