#!/usr/bin/env sh
set -eu

sh ./scripts/ensure-dev-compose.sh

DB_URL="${PLAYWRIGHT_DATABASE_URL:-${DATABASE_URL:-postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e}}"

DATABASE_URL="$DB_URL" bun packages/server/src/db/reset.ts
DATABASE_URL="$DB_URL" bun run db:push:ci
DATABASE_URL="$DB_URL" bun packages/server/src/db/services/run-seed.ts
DATABASE_URL="$DB_URL" bun packages/server/src/db/services/seed-e2e-auth-users.ts
PLAYWRIGHT_DATABASE_URL="$DB_URL" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true bunx playwright test "$@"
