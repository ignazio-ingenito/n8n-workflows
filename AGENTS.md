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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **n8n-workflows** (138 symbols, 130 relationships, 0 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/n8n-workflows/context` | Codebase overview, check index freshness |
| `gitnexus://repo/n8n-workflows/clusters` | All functional areas |
| `gitnexus://repo/n8n-workflows/processes` | All execution flows |
| `gitnexus://repo/n8n-workflows/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
