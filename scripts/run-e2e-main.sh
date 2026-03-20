#!/usr/bin/env sh
set -eu

sh ./scripts/ensure-dev-compose.sh

DB_URL="${PLAYWRIGHT_DATABASE_URL:-${DATABASE_URL:-postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e}}"
E2E_BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-daoflow-e2e-secret-with-enough-entropy-2026}"
E2E_ENCRYPTION_KEY="${ENCRYPTION_KEY:-daoflow-e2e-encryption-key-32chars00}"

DATABASE_URL="$DB_URL" bun packages/server/src/db/reset.ts
DATABASE_URL="$DB_URL" bun run db:push:ci
# Keep seed-time encryption aligned with the Playwright server env.
DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" bun packages/server/src/db/services/run-seed.ts
DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" bun packages/server/src/db/services/seed-e2e-auth-users.ts
PLAYWRIGHT_DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true bunx playwright test "$@"
