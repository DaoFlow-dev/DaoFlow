#!/usr/bin/env sh
set -eu

BOOTSTRAP_DB_URL="${PLAYWRIGHT_BOOTSTRAP_DATABASE_URL:-${PLAYWRIGHT_DATABASE_URL:-${DATABASE_URL:-postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e_bootstrap}}}"

PLAYWRIGHT_BOOTSTRAP_DATABASE_URL="$BOOTSTRAP_DB_URL" bunx playwright test --config playwright.bootstrap.config.ts "$@"
