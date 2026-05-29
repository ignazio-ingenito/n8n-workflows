#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
namespace="${N8N_NAMESPACE:-apps}"
target="${N8N_KUBECTL_TARGET:-deploy/n8n}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
export_dir="${root_dir}/tmp/live-export-${timestamp}"
archive="${export_dir}.tgz"
apply=0

usage() {
  cat <<USAGE
Usage: $0 [--apply]

Exports live n8n workflows and non-decrypted credentials through the n8n server
CLI running in Kubernetes.

Environment:
  N8N_NAMESPACE        Kubernetes namespace, default: apps
  N8N_KUBECTL_TARGET  kubectl exec target, default: deploy/n8n

Options:
  --apply   Copy workflows into workflows/ and SOPS-encrypt credential exports
            into credentials/*.enc.json after export validation.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply)
      apply=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required" >&2
  exit 1
fi

if [ "${apply}" -eq 1 ] && ! command -v sops >/dev/null 2>&1; then
  echo "sops is required when using --apply" >&2
  exit 1
fi

if [ "${apply}" -eq 1 ] && ! command -v jq >/dev/null 2>&1; then
  echo "jq is required when using --apply" >&2
  exit 1
fi

mkdir -p "${export_dir}"

echo "Exporting live n8n data from ${namespace}/${target} to ${export_dir}" >&2
kubectl -n "${namespace}" exec "${target}" -- /bin/sh -ec '
  rm -rf /tmp/n8n-git-export
  mkdir -p /tmp/n8n-git-export/workflows /tmp/n8n-git-export/credentials
  n8n export:workflow --backup --output=/tmp/n8n-git-export/workflows >&2
  n8n export:credentials --backup --output=/tmp/n8n-git-export/credentials >&2
  tar -C /tmp/n8n-git-export -czf - workflows credentials
' > "${archive}"

tar -xzf "${archive}" -C "${export_dir}"

workflow_count="$(find "${export_dir}/workflows" -type f -name '*.json' | wc -l | tr -d ' ')"
credential_count="$(find "${export_dir}/credentials" -type f -name '*.json' | wc -l | tr -d ' ')"
echo "Exported ${workflow_count} workflow file(s) and ${credential_count} credential file(s)." >&2

if [ "${apply}" -eq 0 ]; then
  echo "Review export under ${export_dir}. Re-run with --apply to update the repository." >&2
  exit 0
fi

mkdir -p "${root_dir}/workflows" "${root_dir}/credentials"

if [ "${workflow_count}" -gt 0 ]; then
  find "${export_dir}/workflows" -type f -name '*.json' -print0 \
    | while IFS= read -r -d '' file; do
        jq '.active = false' "${file}" > "${root_dir}/workflows/$(basename "${file}")"
      done
fi

if [ "${credential_count}" -gt 0 ]; then
  find "${export_dir}/credentials" -type f -name '*.json' -print0 \
    | while IFS= read -r -d '' file; do
        name="$(basename "${file}" .json)"
        output="${root_dir}/credentials/${name}.enc.json"
        sops -e \
          --input-type json \
          --output-type json \
          --filename-override "credentials/${name}.enc.json" \
          "${file}" > "${output}"
      done
fi

"${root_dir}/scripts/validate-workflows.sh"
