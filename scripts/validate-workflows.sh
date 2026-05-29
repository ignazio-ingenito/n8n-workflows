#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow_dir="${root_dir}/workflows"
credential_dir="${root_dir}/credentials"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to validate workflow JSON files" >&2
  exit 1
fi

workflow_found=0

while IFS= read -r -d '' file; do
  workflow_found=1
  jq -e '
    type == "object"
    and (.name | type == "string" and length > 0)
    and (.nodes | type == "array")
    and (.connections | type == "object")
  ' "${file}" >/dev/null

  if jq -e '
    tostring
    | test("(?i)(-----BEGIN (OPENSSH|RSA|DSA|EC|PRIVATE)|github_pat_|ghp_|xox[baprs]-|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ya29\\.|Bearer [A-Za-z0-9._-]{20,})")
  ' "${file}" >/dev/null; then
    echo "Potential secret-like value found in ${file}; review before committing." >&2
    exit 1
  fi

  echo "OK ${file#${root_dir}/}"
done < <(find "${workflow_dir}" -type f -name '*.json' -print0 | sort -z)

if [ "${workflow_found}" -eq 0 ]; then
  echo "No workflow JSON files found under workflows/."
fi

credential_found=0

while IFS= read -r -d '' file; do
  credential_found=1

  if ! command -v sops >/dev/null 2>&1; then
    echo "sops is required to validate encrypted credential exports" >&2
    exit 1
  fi

  decrypted="$(mktemp)"
  trap 'rm -f "${decrypted}"' EXIT
  sops -d "${file}" > "${decrypted}"

  jq -e '
    type == "object" or type == "array"
  ' "${decrypted}" >/dev/null

  if ! jq -e '
    def credential_items:
      if type == "array" then .[]
      elif type == "object" and (.data? | type == "array") then .data[]
      else .
      end;

    [
      credential_items
      | select(type == "object" and has("data") and (.data | type == "object"))
    ]
    | length == 0
  ' "${decrypted}" >/dev/null; then
    echo "Credential export ${file#${root_dir}/} appears to contain decrypted credential data." >&2
    exit 1
  fi

  if jq -e '
    tostring
    | test("(?i)(-----BEGIN (OPENSSH|RSA|DSA|EC|PRIVATE)|github_pat_|ghp_|xox[baprs]-|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ya29\\.|Bearer [A-Za-z0-9._-]{20,})")
  ' "${decrypted}" >/dev/null; then
    echo "Potential plaintext secret found in ${file#${root_dir}/}; review before committing." >&2
    exit 1
  fi

  rm -f "${decrypted}"
  trap - EXIT

  echo "OK ${file#${root_dir}/}"
done < <(find "${credential_dir}" -type f -name '*.enc.json' -print0 | sort -z)

if [ "${credential_found}" -eq 0 ]; then
  echo "No encrypted credential exports found under credentials/."
fi
