# n8n Workflows Context

## Glossary

**Workflow Repository**: This repository, intended to store n8n workflow JSON
files and validation helpers.

**Homelab Repository**: `/home/iingenito/projects/personal/homelab`, the GitOps
source of truth for Kubernetes, ArgoCD, SOPS, CNPG, and app manifests.

**Workflow JSON**: The JSON representation of an n8n workflow exported from n8n
or authored for import into n8n.

**Importer Job**: A Kubernetes Job, managed from the homelab repository, that
loads workflow JSON files into the n8n database.

**Activation Allowlist**: A future explicit list of workflow IDs or file names
that may be activated automatically after import.

**Credential Stub**: A workflow reference to an n8n credential by ID or name. It
does not contain the credential value, but can still disclose sensitive naming.

**Runtime Credential**: A real secret value stored in n8n or a SOPS-managed
Kubernetes Secret. Runtime credentials must not be committed here.

**Credential Export Backup**: A non-decrypted n8n credential export kept for
disaster recovery. In this repository it must be SOPS-encrypted under
`credentials/*.enc.json`. A decrypted credential export is a runtime secret and
must not be committed.

**n8n Source Control**: n8n's native Git integration for environments. It is not
available for this installation because no Business/Enterprise license is
present.

## Current Decisions

- Use a repository separate from `homelab` for workflow JSON.
- Do not rely on n8n Source Control.
- Plan for GitOps import through Kubernetes, not manual pod mutation.
- Import workflows as inactive and keep activation manual in the n8n UI.
- Version workflow JSON in clear text after review.
- Version credential export backups only when they are non-decrypted and
  SOPS-encrypted.

## Open Questions

- Should workflow JSON be exported from the live instance first, or should a
  dummy workflow prove the import path before exporting current workflows?
- Should this repository get its own GitHub Actions validation workflow before
  ArgoCD integration?
