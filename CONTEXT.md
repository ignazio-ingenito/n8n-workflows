# n8n Workflows Context

**Status:** Active

## Glossary

**Workflow Repository**: This repository, intended to store n8n workflow JSON
files and validation helpers.

**Homelab Repository**: `/home/iingenito/projects/personal/homelab`, the GitOps
source of truth for Kubernetes, ArgoCD, SOPS, CNPG, and app manifests.

**Workflow JSON**: The JSON representation of an n8n workflow exported from n8n
or authored for import into n8n.

**Importer Job**: The Kubernetes Job managed from the homelab repository that
loads workflow JSON files into the n8n database. The current implementation
snapshots which Git-managed workflows are already published before import and
republishes only those after import.

**Credential Stub**: A workflow reference to an n8n credential by ID or name. It
does not contain the credential value, but can still disclose sensitive naming.

**Runtime Credential**: A real secret value stored in n8n or a SOPS-managed
Kubernetes Secret. Runtime credentials must not be committed here.

**Credential Export Backup**: A non-decrypted n8n credential export kept for
disaster recovery. In this repository it must be SOPS-encrypted under
`credentials/*.enc.json`. A decrypted credential export is a runtime secret and
must not be committed.

**n8n Source Control**: n8n's native Git integration for environments. It is not
configured by the repository state verified for Task 9. Its current licensing
entitlement must be checked on the live n8n installation before availability or
unavailability is used as a design constraint.

**Alert Query History**: The operational history of job-alert query quality for
`Job Search Email Alerts`. It is stored in the n8n Data Table
`job_alert_query_history`, one row per query and cycle, so it can be inspected
or reset from the n8n UI.

## Current Decisions

- The strategic source of truth for job-search positioning, role families,
  query seeds, scoring, market-observatory rules and calibration lives in the
  `resume` repository, under:
  - `/home/iingenito/projects/personal/resume/profile/positioning.md`
  - `/home/iingenito/projects/personal/resume/profile/target-roles.md`
  - `/home/iingenito/projects/personal/resume/job-search/market-observatory-spec.md`
  - `/home/iingenito/projects/personal/resume/job-search/linkedin-query-seeds.md`
  - `/home/iingenito/projects/personal/resume/job-search/italy-market-sources.md`
  - `/home/iingenito/projects/personal/resume/job-search/scoring-model.md`
  - `/home/iingenito/projects/personal/resume/automations/n8n-workflows.md`
- Use a repository separate from `homelab` for workflow JSON.
- The deployed import path is the Kubernetes Job owned by `homelab`; it is not a
  future/planned mechanism.
- Git is the source of workflow definitions. The current importer nevertheless
  reads live publication state before import and preserves that state for
  workflows already published. This hidden live-state dependency is current
  behavior, not a target invariant, and is under review in Wave #33 Task 9.
- `n8n import:workflow` leaves imported workflows inactive by default. New
  workflows therefore remain inactive on first import; first publication is a
  manual runtime decision. Existing Git-managed workflows that were already
  published are republished by the current importer after import.
- Do not assume n8n Source Control is available or unavailable until the current
  entitlement is verified.
- Version workflow JSON in clear text after review.
- Version credential export backups only when they are non-decrypted and
  SOPS-encrypted.
- Store `Job Search Email Alerts` query-quality history in the n8n Data Table
  `job_alert_query_history`, not workflow static data, so test runs can be reset
  manually and the rolling 5-cycle recommendation window remains auditable.

## Current Open Question

- For Wave #33 Task 9, verify the live n8n Source Control entitlement before
  choosing whether the importer can move to a native n8n ownership model or
  needs another deterministic Git-to-runtime path.

## Documentation Authority

- `README.md` is the current repository-level operating description.
- Runtime importer behavior is authoritative in
  `ignazio-ingenito/homelab/gitops/apps/n8n-workflows/import-job.yaml` and its
  runbook `ignazio-ingenito/homelab/doc/28-n8n-workflow-gitops-importer.md`.
- Dated files under `docs/` are historical handoffs unless explicitly promoted
  to an Active source. They must not override current manifests, README, or this
  context.

## Repository Scope Reminder

This repository is the operational companion for the job-search automations.
It stores exported workflow JSON, import and activation notes, and the UI-level
credential binding steps needed to make the workflows run.

It does not own the underlying positioning model, target-role taxonomy, query
seed set, scoring model, or market-observatory rules; those remain in the
`resume` repository and should be edited there first.
