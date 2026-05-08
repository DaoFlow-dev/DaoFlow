#!/usr/bin/env sh
set -eu

sh ./scripts/ensure-dev-compose.sh

DB_URL="${PLAYWRIGHT_DATABASE_URL:-${DATABASE_URL:-postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e}}"
E2E_BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-daoflow-e2e-secret-with-enough-entropy-2026}"
E2E_ENCRYPTION_KEY="${ENCRYPTION_KEY:-daoflow-e2e-encryption-key-32chars00}"
PLAYWRIGHT_BIN="${PLAYWRIGHT_BIN:-./node_modules/.bin/playwright}"

bun ./scripts/ensure-e2e-database-url.ts "$DB_URL" "PLAYWRIGHT_DATABASE_URL"
DATABASE_URL="$DB_URL" bun packages/server/src/db/reset.ts
DATABASE_URL="$DB_URL" bun run db:migrate
# Keep seed-time encryption aligned with the Playwright server env.
DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" DAOFLOW_SEED_DEMO=1 bun packages/server/src/db/services/run-seed.ts
DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" bun packages/server/src/db/services/seed-e2e-auth-users.ts
bun run build

if [ "$#" -gt 0 ]; then
  PLAYWRIGHT_DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true PLAYWRIGHT_SKIP_SERVER_BUILD=true "$PLAYWRIGHT_BIN" test "$@"
else
  PLAYWRIGHT_DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true PLAYWRIGHT_SKIP_SERVER_BUILD=true "$PLAYWRIGHT_BIN" test \
    e2e/approvals.spec.ts \
    e2e/auth.spec.ts \
    e2e/backup-destinations.spec.ts \
    e2e/backup-e2e.spec.ts \
    e2e/backups.spec.ts \
    e2e/cli-smoke.spec.ts \
    e2e/compose.spec.ts \
    e2e/deployments.spec.ts \
    e2e/env-vars.spec.ts \
    e2e/home.spec.ts \
    e2e/migration.spec.ts \
    e2e/onboarding.spec.ts \
    e2e/openclaw-e2e.spec.ts && \
  PLAYWRIGHT_DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true PLAYWRIGHT_SKIP_SERVER_BUILD=true "$PLAYWRIGHT_BIN" test \
    e2e/rbac.spec.ts \
    e2e/servers.spec.ts && \
  PLAYWRIGHT_DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$E2E_BETTER_AUTH_SECRET" ENCRYPTION_KEY="$E2E_ENCRYPTION_KEY" PLAYWRIGHT_SKIP_DB_BOOTSTRAP=true PLAYWRIGHT_SKIP_SERVER_BUILD=true "$PLAYWRIGHT_BIN" test \
    e2e/service-observability.spec.ts \
    e2e/webhooks.spec.ts
fi
