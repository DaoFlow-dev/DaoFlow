#!/usr/bin/env bash
set -euo pipefail

: "${E2E_SCRIPT:?E2E_SCRIPT must name the package script to run}"

BUN_BIN="${BUN_BIN:-bun}"
E2E_LOG_FILE="${E2E_LOG_FILE:-e2e-ci.log}"

run_lane() {
  if [[ -n "${E2E_SPECS:-}" ]]; then
    local specs=()
    read -r -a specs <<< "$E2E_SPECS"
    "$BUN_BIN" run "$E2E_SCRIPT" -- "${specs[@]}"
  else
    "$BUN_BIN" run "$E2E_SCRIPT"
  fi
}

run_and_log() {
  set +e
  run_lane 2>&1 | tee -a "$E2E_LOG_FILE"
  local pipeline_status=("${PIPESTATUS[@]}")
  set -e

  if ((pipeline_status[0] != 0)); then
    return "${pipeline_status[0]}"
  fi

  return "${pipeline_status[1]}"
}

has_bun_native_crash() {
  grep -Eq 'SIG(ABRT|ILL|SEGV)|panic\(main thread\)|oh no: Bun has crashed' "$E2E_LOG_FILE"
}

: > "$E2E_LOG_FILE"

if run_and_log; then
  exit 0
else
  first_status=$?
fi

if ! has_bun_native_crash; then
  exit "$first_status"
fi

printf '\nBun runtime crash detected; retrying this E2E lane once from a clean database.\n\n' |
  tee -a "$E2E_LOG_FILE"
run_and_log
