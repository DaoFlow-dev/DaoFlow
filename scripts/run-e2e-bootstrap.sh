#!/usr/bin/env sh
set -eu

sh ./scripts/ensure-dev-compose.sh

BASE_DB_URL="${PLAYWRIGHT_DATABASE_URL:-${DATABASE_URL:-postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e}}"
DEFAULT_BOOTSTRAP_DB_URL="${BASE_DB_URL%/*}/${BASE_DB_URL##*/}_bootstrap"
BOOTSTRAP_DB_URL="${PLAYWRIGHT_BOOTSTRAP_DATABASE_URL:-$DEFAULT_BOOTSTRAP_DB_URL}"
E2E_BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-daoflow-e2e-secret-with-enough-entropy-2026}"
E2E_ENCRYPTION_KEY="${ENCRYPTION_KEY:-daoflow-e2e-encryption-key-32chars00}"

DATABASE_URL="$BOOTSTRAP_DB_URL" bun packages/server/src/db/reset.ts
DATABASE_URL="$BOOTSTRAP_DB_URL" bun run db:push:ci
PLAYWRIGHT_BOOTSTRAP_DATABASE_URL="$BOOTSTRAP_DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true bunx playwright test --config playwright.bootstrap.config.ts "$@"
