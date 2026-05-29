# n8n Workflows GitOps Handoff

Date: 2026-05-29

## Goal

Create a repeatable path where n8n workflow JSON files committed to a GitHub
repository are imported into the homelab n8n instance running in Kubernetes.

## Context

- The homelab n8n instance is deployed from
  `/home/iingenito/projects/personal/homelab/gitops/apps/n8n`.
- The cluster deployment uses `n8nio/n8n:2.23.1`.
- n8n runs in namespace `apps` as a single `Deployment`.
- n8n stores runtime state in PostgreSQL through CNPG and mounts PVC `n8n-data`.
- The n8n UI is exposed at `https://n8n.skunklabs.uk`.
- Webhooks are exposed at `https://hooks.skunklabs.uk`.
- The installation has no n8n Business/Enterprise license, so native n8n Source
  Control is out of scope.

## External References

- n8n workflow export/import:
  `https://docs.n8n.io/workflows/export-import/`
- n8n server CLI import/export:
  `https://docs.n8n.io/hosting/cli-commands/`
- n8n public API reference:
  `https://docs.n8n.io/api/api-reference/`
- n8n Source Control availability:
  `https://docs.n8n.io/source-control-environments/`

## Chosen Direction

Use a separate private GitHub repository, `n8n-workflows`, as the workflow source
repository. Use the homelab GitOps repository to define a Kubernetes importer
Job that reads these workflow JSON files and imports them into n8n.

The implementation imports workflows as inactive. Activation stays manual in the
n8n UI because active workflow behavior, cron triggers, and webhook exposure
need explicit human control.

For Baialupo-specific editorial flows, the shortlist generation stays outside
n8n. The workflow receives up to 5 candidate articles through a webhook. The
payload must include `chat_id` so n8n can send the Telegram notification. n8n
stores the pending shortlist in a Data Table keyed by `runId`, then renders
the title as the approval link from `hooks.skunklabs.uk/webhook/baia/telegram/approve`.
Clicking the title
selects exactly one article, toggles `featured` only on that markdown file,
commits the change to `baialupo.com`, and dispatches the Baialupo deploy
pipeline. A separate scheduled workflow scans published posts and demotes
`featured: 0` on articles whose `expires` date is in the past.

The Telegram bot credential itself stays in n8n and must be attached there
after import; it is not stored in this repository.

## Options Considered

### Option A: Native n8n Source Control

Rejected for now.

Reason: it requires a Business/Enterprise feature that is not available in this
installation.

### Option B: GitOps Importer Job

Recommended.

Pattern:

1. Workflow JSON lives in this repository under `workflows/`.
2. ArgoCD watches a dedicated Application or manifest in the homelab repository.
3. A Kubernetes Job runs the n8n server CLI:

   ```bash
   n8n import:workflow --separate --input=/workflows
   ```

4. The Job uses the same database environment and encryption key as the n8n
   Deployment.

Trade-offs:

- Pro: works without n8n license.
- Pro: stays aligned with the existing GitOps operating model.
- Pro: keeps infrastructure changes in `homelab` and workflow content here.
- Con: importing workflows does not automatically solve activation and
  credential readiness.
- Con: running CLI against the live DB must be tested carefully.

### Option C: GitHub Action Calling n8n Public API

Possible later.

Trade-offs:

- Pro: natural trigger on GitHub commits.
- Pro: can create/update/activate workflows through API operations.
- Con: requires managing an n8n API key.
- Con: needs network access from the runner to n8n or a self-hosted runner.
- Con: the n8n API/CLI path is more exposed than an in-cluster Job.

## Proposed Repository Structure

```text
n8n-workflows/
  AGENTS.md
  CONTEXT.md
  README.md
  workflows/
    .gitkeep
  docs/
    2026-05-29-n8n-workflows-gitops-handoff.md
  scripts/
    validate-workflows.sh
    export-live.sh
```

## Implementation Plan

### Phase 1: Repository Bootstrap

- [x] Create this repository locally.
- [x] Add `AGENTS.md`, `CONTEXT.md`, `README.md`, `.gitignore`.
- [x] Add `workflows/`, `docs/`, and `scripts/`.
- [x] Add `scripts/validate-workflows.sh`.
- [x] Run validation with no workflows.
- [x] Initialize Git and commit.
- [x] Create private GitHub repository and push.

### Phase 2: Prove Workflow JSON Handling

- [x] Add one harmless dummy workflow JSON locally.
- [x] Save it under `workflows/`.
- [x] Run `./scripts/validate-workflows.sh`.
- [x] Review JSON for credential names, IDs, headers, tokens, or private data.
- [x] Commit the workflow JSON.

### Phase 3: Design Homelab Importer

Files likely to change in homelab:

- `gitops/apps/applications/n8n-workflows.yaml`
- `gitops/apps/kustomization.yaml`
- `gitops/apps/n8n-workflows/kustomization.yaml`
- `gitops/apps/n8n-workflows/import-job.yaml`
- `gitops/apps/n8n-workflows/rbac.yaml` if the Job needs Kubernetes API access
- `doc/` runbook for n8n workflow GitOps operations

Importer design choices to resolve:

- Use ConfigMap-generated workflow files for small workflows, or clone this repo
  from GitHub at runtime.
- If cloning, decide how to store the GitHub deploy key or token with SOPS.
- Decide whether the Job runs as an ArgoCD hook or as an ordinary Job recreated
  on each commit.

Recommended first implementation:

- Clone repo at runtime with a read-only deploy key stored in SOPS.
- Run a Kubernetes Job in namespace `apps`.
- Use the existing n8n image tag from the live Deployment.
- Reuse n8n DB environment variables and `N8N_ENCRYPTION_KEY`.
- Run `n8n import:workflow --separate --input=/workflows`.
- Do not auto-activate workflows in the first pass.

### Phase 4: Import Verification

Minimum checks:

```bash
kubectl -n argocd get application n8n-workflows
kubectl -n apps get job,pod -l app.kubernetes.io/name=n8n-workflows
kubectl -n apps logs job/<import-job-name>
kubectl -n apps logs deploy/n8n --tail=100
```

Manual UI check:

- Open `https://n8n.skunklabs.uk`.
- Confirm imported workflow appears.
- Confirm it is inactive. Activation is manual in the n8n UI.

### Phase 5: Activation Strategy

Current decision: activation stays manual in the n8n UI.

Do not add `--activeState=fromJson`, an activation allowlist, or n8n API-based
activation unless this decision is explicitly revisited. Imported workflows
should remain inactive after the GitOps import job finishes.

### Phase 6: Live Export And Restore Drill

Current decisions:

- Export live workflow JSON through `scripts/export-live.sh`.
- Keep credential backups only as non-decrypted n8n credential exports.
- Store credential backups as SOPS-encrypted `credentials/*.enc.json`.
- Do not commit decrypted credential exports.
- Test restore only against an isolated temporary database or restored CNPG
  cluster, never against the live `n8n` database.

Read-only live export:

```bash
./scripts/export-live.sh
```

Apply reviewed export to this repository:

```bash
./scripts/export-live.sh --apply
./scripts/validate-workflows.sh
```

The apply step stores workflow JSON with `active: false` even when the live
workflow is active, so GitOps restore/import keeps activation manual.

Restore drill outline:

1. Create or restore an isolated PostgreSQL target.
2. Run n8n CLI with the same `N8N_ENCRYPTION_KEY`.
3. Import workflow JSON and non-decrypted credential exports into the isolated
   target only.
4. Verify workflow and credential counts.
5. Keep all workflows inactive; do not expose public routes.

## Security Notes

- Workflow JSON can expose credential names, endpoint URLs, headers, and private
  business logic.
- Do not commit decrypted credentials.
- Do not commit API keys or webhook secrets.
- The importer Job must use least-privilege secrets.
- Prefer a read-only GitHub deploy key for pulling workflow JSON.
- Do not add n8n API keys for activation while activation remains manual.

## Rollback Plan

- Revert the workflow commit in this repository.
- Re-run the importer Job to restore previous JSON definitions.
- If import corrupts production workflows, restore the n8n PostgreSQL database
  from CNPG backup according to the homelab backup runbook.
- Keep automatic activation disabled.

## Open Questions

1. Should the importer clone this repository at runtime, or should homelab vendor
   workflow JSON through a Git submodule or generated ConfigMap?
2. Should workflow import overwrite existing workflow IDs, or should IDs be
   stripped for initial imports?
3. Should GitHub Actions validate workflow JSON before merge?
4. Should this repository become private-only policy in AGENTS and README once
   the remote is created?

## Suggested First Commits

```text
docs: bootstrap n8n workflow repository
chore(validation): add n8n workflow JSON checks
feat(workflows): add initial dummy workflow
feat(n8n): add GitOps workflow importer
```
