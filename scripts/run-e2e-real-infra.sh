#!/usr/bin/env sh
set -eu

if [ "${DAOFLOW_REAL_INFRA:-}" != "1" ]; then
  printf '%s\n' 'DAOFLOW_REAL_INFRA=1 is required for the real-infrastructure harness.' >&2
  exit 1
fi

if [ "${DAOFLOW_REAL_INFRA_RUN_TOKEN:-}" = "" ]; then
  DAOFLOW_REAL_INFRA_RUN_TOKEN="ri$(od -An -N10 -tx1 /dev/urandom | tr -d ' \n')"
  export DAOFLOW_REAL_INFRA_RUN_TOKEN
fi

export DAOFLOW_REAL_INFRA_ARTIFACT_DIR="${DAOFLOW_REAL_INFRA_ARTIFACT_DIR:-test-results/real-infra/$DAOFLOW_REAL_INFRA_RUN_TOKEN}"
export DAOFLOW_REAL_INFRA_WORKSPACE_ROOT="/tmp/daoflow-real-infra/$DAOFLOW_REAL_INFRA_RUN_TOKEN"
export DAOFLOW_REAL_INFRA_LOCAL_STATE_ROOT="/tmp/dfri/$DAOFLOW_REAL_INFRA_RUN_TOKEN"

finish() {
  bun ./e2e/fixtures/real-infra/finalize-artifacts.ts >/dev/null 2>&1 || true
  case "$DAOFLOW_REAL_INFRA_LOCAL_STATE_ROOT" in
    /tmp/dfri/ri*) rm -rf -- "$DAOFLOW_REAL_INFRA_LOCAL_STATE_ROOT" ;;
  esac
}
trap finish EXIT

bun ./e2e/fixtures/real-infra/reset-artifacts.ts

run_step() {
  label="$1"
  shift
  bun ./e2e/fixtures/real-infra/command.ts "$label" "$@"
}

if ! bun ./e2e/fixtures/real-infra/preflight.ts; then
  printf '%s\n' "Real-infrastructure preflight failed; see $DAOFLOW_REAL_INFRA_ARTIFACT_DIR/result.json." >&2
  exit 1
fi

DATABASE_URL="$PLAYWRIGHT_REAL_INFRA_DATABASE_URL" run_step reset-control-plane bun packages/server/src/db/reset.ts
DATABASE_URL="$PLAYWRIGHT_REAL_INFRA_DATABASE_URL" run_step migrate-control-plane bun run db:migrate
DATABASE_URL="$PLAYWRIGHT_REAL_INFRA_DATABASE_URL" \
  BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  DAOFLOW_SEED_DEMO=1 \
  run_step seed-control-plane bun packages/server/src/db/services/run-seed.ts
DATABASE_URL="$PLAYWRIGHT_REAL_INFRA_DATABASE_URL" \
  BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  run_step seed-e2e-auth bun packages/server/src/db/services/seed-e2e-auth-users.ts

run_step build-control-plane bun run build
DATABASE_URL="$PLAYWRIGHT_REAL_INFRA_DATABASE_URL" \
  PLAYWRIGHT_SKIP_SERVER_BUILD=true \
  run_step playwright-real-infra ./node_modules/.bin/playwright test --config playwright.real-infra.config.ts
