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
runs `publish:workflow` for those IDs after import.

**Published Workflow**: n8n 2.x terminology for a workflow version that is live
for trigger execution. Older exports and CLI flags can still expose the legacy
`active` field/name. Current documentation should prefer published/unpublished
when describing runtime state.

**Credential Stub**: A workflow reference to an n8n credential by ID or name. It
does not contain the credential value, but can still disclose sensitive naming.

**Runtime Credential**: A real secret value stored in n8n or a SOPS-managed
Kubernetes Secret. Runtime credentials must not be committed here.

**Credential Export Backup**: A non-decrypted n8n credential export kept for
disaster recovery. In this repository it must be SOPS-encrypted under
`credentials/*.enc.json`. A decrypted credential export is a runtime secret and
must not be committed.

**n8n Source Control**: n8n's native Git integration for environments. It is not
configured by the repository state verified for Task 9. The live entitlement
check attempted during Task 9 was blocked by cluster unavailability, so current
licensing entitlement remains unverified. Availability or unavailability must
not be inferred from repository state.

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
- Wave #33 Task 9 concluded **KEEP minimal** for the current importer because
  removing it would remove the operational Git → n8n database import path and
  no equivalent replacement was verified for the current installation.
- Git is the source of workflow definitions. The current importer nevertheless
  reads live publication state before import and restores the corresponding
  published state in the database for workflows that were already published.
  This hidden live-state dependency is current behavior, not a target invariant.
- `n8n import:workflow` makes imported workflows unpublished by default. New
  workflows therefore remain unpublished on first import; first publication is
  a manual runtime decision.
- On the current non-multi-main design, import/publish through the Server CLI
  has a runtime caveat: previously running cron triggers can remain loaded after
  import, while `publish:workflow` changes made against the live database do not
  take effect in the running n8n process until restart. Restoring published DB
  state therefore does not prove that a newly imported workflow version is the
  version currently executing.
- Task 9 did not resolve that caveat by adding more custom orchestration. Reassess
  the importer only when live entitlement/runtime access or changed upstream
  capabilities provide new evidence.
- Do not assume n8n Source Control is available or unavailable until the current
  entitlement can be verified live.
- Version workflow JSON in clear text after review.
- Version credential export backups only when they are non-decrypted and
  SOPS-encrypted.
- Store `Job Search Email Alerts` query-quality history in the n8n Data Table
  `job_alert_query_history`, not workflow static data, so test runs can be reset
  manually and the rolling 5-cycle recommendation window remains auditable.

## Deferred Runtime Fact

- n8n Source Control entitlement is still **unverified**, not an active Task 9
  blocker. Re-check it only when runtime access is available or when a changed
  upstream capability justifies reopening the importer ownership decision. The
  Server CLI exposes `n8n license:info` for inspecting the installed license
  state; do not repeat failed cluster-access attempts merely to refresh this
  fact.

## Documentation Authority

- `README.md` is the current repository-level operating description.
- Runtime importer behavior is authoritative in
  `ignazio-ingenito/homelab/gitops/apps/n8n-workflows/import-job.yaml` and its
  runbook `ignazio-ingenito/homelab/doc/28-n8n-workflow-gitops-importer.md`.
- Dated files under `docs/` are historical handoffs unless explicitly promoted
  to an Active source. They must not override current manifests, README, or this
  context.

## Repository Scope Reminder

This repository stores and reviews n8n workflow definitions plus the minimal
export/import operating context needed to manage them. It currently includes
workflows for several domains, including job-search, Baialupo and homelab
notifications.

Domain-specific sources of truth stay with their owning repositories. In
particular, job-search positioning, target-role taxonomy, query seeds, scoring
and market-observatory rules remain in the `resume` repository and should be
edited there first.
