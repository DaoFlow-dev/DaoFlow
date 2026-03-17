#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${DAOFLOW_DEV_COMPOSE_FILE:-docker-compose.dev.yml}"

if docker compose -f "$COMPOSE_FILE" up --help 2>/dev/null | grep -q -- "--wait"; then
  docker compose -f "$COMPOSE_FILE" up -d --wait
else
  docker compose -f "$COMPOSE_FILE" up -d
fi
