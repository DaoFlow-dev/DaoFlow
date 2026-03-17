#!/usr/bin/env sh
set -eu

DB_URL="${PLAYWRIGHT_DATABASE_URL:-${DATABASE_URL:-postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e}}"

DATABASE_URL="$DB_URL" bun run db:rebuild
DATABASE_URL="$DB_URL" bun run db:seed:e2e-auth
PLAYWRIGHT_DATABASE_URL="$DB_URL" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true bunx playwright test "$@"
