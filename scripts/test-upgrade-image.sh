#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  echo "Usage: $0 <previous-commit-sha> <candidate-image>" >&2
}

fail() {
  echo "[upgrade-test] $*" >&2
  exit 1
}

if [[ $# -ne 2 ]]; then
  usage
  exit 2
fi

PREVIOUS_REF="$1"
CANDIDATE_IMAGE="$2"
ADMIN_DATABASE_URL="${DAOFLOW_UPGRADE_ADMIN_DATABASE_URL:-}"
BETTER_AUTH_SECRET="${DAOFLOW_UPGRADE_BETTER_AUTH_SECRET:-daoflow-ci-upgrade-secret-with-enough-entropy-2026}"
ENCRYPTION_KEY="${DAOFLOW_UPGRADE_ENCRYPTION_KEY:-daoflow-ci-upgrade-encryption-key-32chars00}"

[[ "$PREVIOUS_REF" =~ ^[0-9a-fA-F]{40}$ ]] || fail "previous ref must be a full 40-character commit SHA"
[[ "$CANDIDATE_IMAGE" =~ ^[[:alnum:]][[:alnum:]_.:/@-]*$ ]] ||
  fail "candidate image contains unsupported characters"
[[ "$ADMIN_DATABASE_URL" =~ ^postgres(ql)?://[^[:space:]]+$ ]] ||
  fail "DAOFLOW_UPGRADE_ADMIN_DATABASE_URL must be a PostgreSQL connection URL"
[[ -n "$BETTER_AUTH_SECRET" ]] || fail "upgrade test Better Auth secret must not be empty"
[[ -n "$ENCRYPTION_KEY" ]] || fail "upgrade test encryption key must not be empty"

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v git >/dev/null 2>&1 || fail "git is required"
command -v psql >/dev/null 2>&1 || fail "psql is required"

git cat-file -e "${PREVIOUS_REF}^{commit}" 2>/dev/null ||
  fail "previous commit is not available in this checkout"
docker image inspect "$CANDIDATE_IMAGE" >/dev/null 2>&1 ||
  fail "candidate image is not available locally"

ADMIN_URL_PREFIX="${ADMIN_DATABASE_URL%/*}"
[[ "$ADMIN_URL_PREFIX" != "$ADMIN_DATABASE_URL" ]] || fail "admin URL must include a database name"

RUN_TOKEN="$(printf '%s' "${GITHUB_RUN_ID:-local}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
ATTEMPT_TOKEN="$(printf '%s' "${GITHUB_RUN_ATTEMPT:-1}" | tr -cd '0-9')"
RUN_TOKEN="${RUN_TOKEN:-local}"
ATTEMPT_TOKEN="${ATTEMPT_TOKEN:-1}"
DATABASE_NAME="$(printf 'daoflow_upgrade_%s_%s_%s_%s' "$RUN_TOKEN" "$ATTEMPT_TOKEN" "$$" "$RANDOM" | cut -c 1-63)"
[[ "$DATABASE_NAME" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || fail "generated database name is invalid"

DATABASE_URL="${ADMIN_URL_PREFIX}/${DATABASE_NAME}"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/daoflow-upgrade.XXXXXX")"
WORKTREE_DIR="$TEMP_ROOT/worktree"
PREVIOUS_IMAGE="daoflow-upgrade-previous:${PREVIOUS_REF:0:12}-$$-$RANDOM"
CONTAINER_NAME="daoflow-upgrade-migration-$$-$RANDOM"
DATABASE_CREATED=false

cleanup() {
  local status=$?
  set +e

  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

  if [[ "$DATABASE_CREATED" == true ]]; then
    psql "$ADMIN_DATABASE_URL" \
      --no-password \
      --set=ON_ERROR_STOP=1 \
      --quiet \
      --command="DROP DATABASE IF EXISTS \"$DATABASE_NAME\"" \
      >/dev/null 2>&1 || true
  fi

  if [[ -e "$WORKTREE_DIR/.git" ]]; then
    git worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  fi

  docker image rm "$PREVIOUS_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! psql "$ADMIN_DATABASE_URL" \
  --no-password \
  --set=ON_ERROR_STOP=1 \
  --quiet \
  --command="CREATE DATABASE \"$DATABASE_NAME\"" \
  >"$TEMP_ROOT/create-database.out" 2>&1; then
  echo "[upgrade-test] could not create the disposable database" >&2
  exit 1
fi
DATABASE_CREATED=true

git worktree add --detach "$WORKTREE_DIR" "$PREVIOUS_REF" >/dev/null
docker build --target runtime --tag "$PREVIOUS_IMAGE" "$WORKTREE_DIR"

run_migrations() {
  local image="$1"

  if ! docker run \
    --name "$CONTAINER_NAME" \
    --rm \
    --network host \
    --env NODE_ENV=production \
    --env DAOFLOW_RUN_MIGRATIONS_ONLY=true \
    --env DISABLE_WORKER=true \
    --env "BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET" \
    --env "ENCRYPTION_KEY=$ENCRYPTION_KEY" \
    --env "DATABASE_URL=$DATABASE_URL" \
    "$image" \
    >"$TEMP_ROOT/${image//[^[:alnum:]_.-]/_}.log" 2>&1; then
    echo "[upgrade-test] migration-only run failed for image $image" >&2
    return 1
  fi
}

run_migrations "$PREVIOUS_IMAGE"
run_migrations "$CANDIDATE_IMAGE"
echo "[upgrade-test] candidate upgraded the previous-main database successfully"
