#!/usr/bin/env sh
set -eu

IMAGE="${1:-${DAOFLOW_SMOKE_IMAGE:-daoflow-smoke:local}}"
PORT="${DAOFLOW_SMOKE_PORT:-3010}"
CONTAINER_NAME="${DAOFLOW_SMOKE_CONTAINER_NAME:-daoflow-production-smoke-$$}"
DATABASE_URL="${DATABASE_URL:-postgresql://daoflow:daoflow_dev@host.docker.internal:5432/daoflow_smoke}"
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-daoflow-smoke-secret-with-enough-entropy-2026}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-daoflow-smoke-encryption-key-32chars00}"
BASE_URL="http://127.0.0.1:${PORT}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

cleanup

docker run -d \
  --name "$CONTAINER_NAME" \
  --add-host host.docker.internal:host-gateway \
  -p "127.0.0.1:${PORT}:${PORT}" \
  -e NODE_ENV=production \
  -e PORT="$PORT" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e BETTER_AUTH_URL="$BASE_URL" \
  -e BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  -e ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  -e DISABLE_WORKER=true \
  "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1 &&
    curl -fsS "${BASE_URL}/ready" >/dev/null 2>&1; then
    curl -fsS "$BASE_URL" | grep -qi "<html"
    exit 0
  fi
  sleep 1
done

docker logs "$CONTAINER_NAME" >&2 || true
echo "Production image smoke test failed: ${BASE_URL} did not become healthy and ready." >&2
exit 1
