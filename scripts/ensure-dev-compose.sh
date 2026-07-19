#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${DAOFLOW_DEV_COMPOSE_FILE:-docker-compose.dev.yml}"

compact_name() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-'
}

# CI and shared runners may reuse a Docker host between jobs. Keep the default
# stack isolated there, while retaining the familiar local `daoflow` database.
if [ -z "${COMPOSE_PROJECT_NAME:-}" ] && [ -n "${DAOFLOW_COMPOSE_PROJECT_NAME:-}" ]; then
  COMPOSE_PROJECT_NAME="$DAOFLOW_COMPOSE_PROJECT_NAME"
  export COMPOSE_PROJECT_NAME
fi

if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
  if [ -z "${COMPOSE_PROJECT_NAME:-}" ]; then
    compose_scope="daoflow-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${GITHUB_JOB:-job}-${GITHUB_RUNNER_ID:-$$}"
    COMPOSE_PROJECT_NAME="$(compact_name "$compose_scope" | cut -c 1-63)"
    export COMPOSE_PROJECT_NAME
  fi

  if [ -z "${DAOFLOW_DATABASE_NAME:-}" ]; then
    database_scope="daoflow_e2e_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}_${GITHUB_JOB:-job}_${GITHUB_RUNNER_ID:-$$}"
    DAOFLOW_DATABASE_NAME="$(compact_name "$database_scope" | cut -c 1-63)"
    export DAOFLOW_DATABASE_NAME
  fi
fi

if docker compose -f "$COMPOSE_FILE" up --help 2>/dev/null | grep -q -- "--wait"; then
  docker compose -f "$COMPOSE_FILE" up -d --wait
else
  docker compose -f "$COMPOSE_FILE" up -d
fi
