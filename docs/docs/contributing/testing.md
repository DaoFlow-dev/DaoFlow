---
sidebar_position: 4
---

# Testing

DaoFlow uses a multi-layer testing strategy.

## Test Types

| Type | Tool | Directory | Runs |
|------|------|-----------|------|
| Unit tests | Bun test runner | `packages/*/src/*.test.ts` | `bun run test` |
| E2E tests | Playwright | `e2e/` | `bunx playwright test` |
| Docs tests | Playwright | `e2e/docs.spec.ts` | `bunx playwright test --config playwright-docs.config.ts` |
| Type checking | TypeScript | — | `bun run typecheck` |

## Running Tests

```bash
# All unit tests
bun run test

# Specific package
cd packages/server && bun test

# E2E tests (requires running infrastructure)
bunx playwright test

# Docs E2E tests
bunx playwright test --config playwright-docs.config.ts

# Type checking
bun run typecheck
```

## Writing Unit Tests

Place test files next to the source:

```
server/src/authz.ts
server/src/authz.test.ts  ← test file
```

Example:

```typescript
import { test, expect, describe } from "bun:test";
import { hasScope, roleCapabilities } from "./authz";

describe("hasScope", () => {
  test("owner has all scopes", () => {
    const caps = roleCapabilities.owner;
    expect(hasScope(caps, "deploy:start")).toBe(true);
    expect(hasScope(caps, "terminal:open")).toBe(true);
  });

  test("viewer cannot deploy", () => {
    const caps = roleCapabilities.viewer;
    expect(hasScope(caps, "deploy:start")).toBe(false);
  });
});
```

## Writing E2E Tests

E2E tests use Playwright. See `e2e/` for examples:

```typescript
import { test, expect } from "@playwright/test";

test("can sign up and see dashboard", async ({ page }) => {
  await page.goto("/auth/sign-up");
  await page.fill('[name="email"]', "test@example.com");
  await page.fill('[name="password"]', "secure-password");
  await page.click('[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
});
```

## CI Integration

Tests run automatically in GitHub Actions on every push and pull request. The CI pipeline:

1. Installs dependencies
2. Runs type checking
3. Runs unit tests
4. Starts infrastructure (Postgres + Redis)
5. Runs E2E tests
6. Builds the docs site
7. Runs docs E2E tests
