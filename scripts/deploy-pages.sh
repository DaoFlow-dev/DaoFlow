#!/usr/bin/env bash

set -euo pipefail

reporting_interval="${REPORTING_INTERVAL:-5}"
timeout_seconds="${TIMEOUT_SECONDS:-600}"
preview="${PREVIEW:-false}"

required_env=(
  GITHUB_TOKEN
  GITHUB_REPOSITORY
  GITHUB_SHA
  GITHUB_SERVER_URL
  GITHUB_API_URL
  ACTIONS_ID_TOKEN_REQUEST_URL
  ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ARTIFACT_ID
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
done

if ! [[ "${reporting_interval}" =~ ^[0-9]+$ ]] || ! [[ "${timeout_seconds}" =~ ^[0-9]+$ ]]; then
  echo "REPORTING_INTERVAL and TIMEOUT_SECONDS must be integers." >&2
  exit 1
fi

owner="${GITHUB_REPOSITORY%%/*}"
repo="${GITHUB_REPOSITORY#*/}"
deadline=$(( $(date +%s) + timeout_seconds ))

api_json() {
  local method="$1"
  local url="$2"
  shift 2

  curl --fail --silent --show-error \
    -X "${method}" \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@" \
    "${url}"
}

oidc_token="$(
  curl --fail --silent --show-error \
    -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pages.github.io" \
    | jq -er '.value'
)"

payload="$(
  jq -n \
    --arg artifact_id "${ARTIFACT_ID}" \
    --arg build_version "${GITHUB_SHA}" \
    --arg oidc_token "${oidc_token}" \
    --argjson preview_flag "$([[ "${preview}" == "true" ]] && printf 'true' || printf 'false')" '
      {
        artifact_id: ($artifact_id | tonumber),
        pages_build_version: $build_version,
        oidc_token: $oidc_token
      }
      + (if $preview_flag then { preview: true } else {} end)
    '
)"

deployment_response="$(
  api_json POST "${GITHUB_API_URL}/repos/${owner}/${repo}/pages/deployments" \
    -H "Content-Type: application/json" \
    --data "${payload}"
)"

deployment_id="$(printf '%s' "${deployment_response}" | jq -er '.id')"
page_url="$(printf '%s' "${deployment_response}" | jq -r '.page_url // empty')"
preview_url="$(printf '%s' "${deployment_response}" | jq -r '.preview_url // empty')"

if [[ -n "${preview_url}" && "${preview}" == "true" ]]; then
  page_url="${preview_url}"
fi

echo "Created Pages deployment ${deployment_id}"
if [[ -n "${page_url}" ]]; then
  echo "page_url=${page_url}" >> "${GITHUB_OUTPUT}"
fi

trap 'api_json POST "${GITHUB_API_URL}/repos/${owner}/${repo}/pages/deployments/${deployment_id}/cancel" >/dev/null 2>&1 || true' INT TERM

while :; do
  if (( $(date +%s) >= deadline )); then
    echo "Timed out waiting for Pages deployment ${deployment_id}" >&2
    api_json POST "${GITHUB_API_URL}/repos/${owner}/${repo}/pages/deployments/${deployment_id}/cancel" >/dev/null 2>&1 || true
    exit 1
  fi

  sleep "${reporting_interval}"

  status_response="$(api_json GET "${GITHUB_API_URL}/repos/${owner}/${repo}/pages/deployments/${deployment_id}")"
  status="$(printf '%s' "${status_response}" | jq -er '.status')"

  case "${status}" in
    succeed)
      echo "Pages deployment ${deployment_id} succeeded"
      exit 0
      ;;
    deployment_failed)
      echo "Pages deployment ${deployment_id} failed" >&2
      exit 1
      ;;
    deployment_perms_error)
      echo "Pages deployment ${deployment_id} failed because of permissions" >&2
      exit 1
      ;;
    deployment_content_failed)
      echo "Pages deployment ${deployment_id} rejected the uploaded artifact" >&2
      exit 1
      ;;
    deployment_cancelled)
      echo "Pages deployment ${deployment_id} was cancelled" >&2
      exit 1
      ;;
    deployment_lost)
      echo "Pages deployment ${deployment_id} lost final status" >&2
      exit 1
      ;;
    *)
      echo "Pages deployment ${deployment_id} status: ${status}"
      ;;
  esac
done
