#!/usr/bin/env sh
set -eu

sh ./scripts/ensure-dev-compose.sh

BASE_DB_URL="${PLAYWRIGHT_DATABASE_URL:-${DATABASE_URL:-postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e}}"
DEFAULT_CLI_DB_URL="${BASE_DB_URL%/*}/${BASE_DB_URL##*/}_cli"
CLI_DB_URL="${PLAYWRIGHT_CLI_DATABASE_URL:-$DEFAULT_CLI_DB_URL}"
E2E_BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-daoflow-e2e-cli-secret-with-enough-entropy-2026}"
E2E_ENCRYPTION_KEY="${ENCRYPTION_KEY:-daoflow-e2e-encryption-key-32chars00}"
PLAYWRIGHT_BIN="${PLAYWRIGHT_BIN:-./node_modules/.bin/playwright}"

DATABASE_URL="$CLI_DB_URL" bun packages/server/src/db/reset.ts
DATABASE_URL="$CLI_DB_URL" bun run db:migrate
DATABASE_URL="$CLI_DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" DAOFLOW_SEED_DEMO=1 bun packages/server/src/db/services/run-seed.ts
DATABASE_URL="$CLI_DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" bun packages/server/src/db/services/seed-e2e-auth-users.ts
PLAYWRIGHT_CLI_DATABASE_URL="$CLI_DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true "$PLAYWRIGHT_BIN" test --config playwright.cli.config.ts "$@"
