# n8n Workflows Agent Instructions

## Purpose

This repository stores n8n workflow definitions for the homelab n8n instance.
The goal is to make workflows reviewable in Git and importable into the
Kubernetes installation managed from the `homelab` GitOps repository.

Default collaboration language is Italian unless the user asks otherwise. Keep
file names, commands, commit messages, and technical identifiers in English.

## Default Workflow

Before changing workflow files, scripts, or GitOps integration documents:

1. Read `AGENTS.md`, `README.md`, `CONTEXT.md`, and the relevant file in `docs/`.
2. Check `git status` before editing.
3. Treat workflow JSON as executable automation, not passive data.
4. Inspect workflow JSON for secrets before committing.
5. Keep credentials, tokens, and variable values out of Git.
6. Use `grill-with-docs` for architecture, workflow ownership, or deployment
   model changes.
7. Use `writing-plans` for multi-step implementation plans.
8. Use `systematic-debugging` before fixing unexplained import, activation, or
   runtime failures.
9. Use `verification-before-completion` before claiming an import, validation,
   or deployment path works.
10. Suggest Conventional Commit messages at the end of implementation work.

## Repository Boundaries

- This repository owns exported n8n workflow JSON and local validation helpers.
- The `homelab` repository owns Kubernetes, ArgoCD, SOPS, CNPG, HTTPRoute, and
  runtime deployment manifests.
- Do not add Kubernetes secrets to this repository.
- Do not store n8n API keys, GitHub tokens, credential values, OAuth tokens, or
  webhook secrets in this repository.
- Do not assume n8n Source Control is available; this installation has no
  Business/Enterprise license.

## Workflow JSON Rules

- Store workflow files under `workflows/`.
- Prefer one workflow per file.
- Run `./scripts/validate-workflows.sh` before committing workflow changes.
- Review exported credential names and IDs before committing. IDs are not secret
  by themselves, but names can reveal sensitive systems or accounts.
- Avoid committing test-only active workflows until the activation strategy is
  explicitly implemented.

## Integration Rules

- Durable Kubernetes changes belong in
  `/home/iingenito/projects/personal/homelab`.
- The planned import mechanism is a GitOps-managed Kubernetes Job that uses the
  same n8n image and database environment as the live n8n deployment.
- First implementation should import workflows as inactive and verify visibility
  in the n8n UI before adding automatic activation.

## Skill Routing

| Work type | Use these skills |
|-----------|------------------|
| Multi-step planning | `writing-plans`, `grill-with-docs` |
| GitOps or cluster integration | `homelab-gitops-operations`, `homelab-kubernetes-operations` |
| n8n import/export, backups, Postgres safety | `homelab-backup-restore`, `systematic-debugging` |
| Secrets or API tokens | `homelab-secret-management`, `security-review` |
| Completion checks | `verification-before-completion` |

## Commit Style

Use Conventional Commits, for example:

```text
docs: add n8n workflow import handoff
feat(workflows): add daily report workflow
chore(validation): add workflow JSON checks
```
