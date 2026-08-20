# n8n Workflows Agent Instructions

**Status:** Active

## Agent OS e lifecycle delle skill

- Prima di analizzare, pianificare, modificare o creare issue o pull request, si DEVE leggere integralmente la versione corrente di [RFC-0001 – Principi fondanti della Software Factory](https://github.com/skunklabs-uk/agent-os/blob/main/rfcs/RFC-0001-principles.md).
- Se la fonte non è accessibile, il lavoro DEVE fermarsi.
- Le regole locali possono restringere la RFC, ma non indebolirla; conflitti o deroghe richiedono l'autorizzazione esplicita dell'utente o di una fonte attiva approvata di autorità superiore.
- Il contenuto della RFC non DEVE essere duplicato in questo repository.
- Le skill riusabili hanno una sola sorgente nel [repository codex-skills](https://github.com/skunklabs-uk/codex-skills). Nei progetti vanno installate tramite symlink con `scripts/install-project.sh`, senza copiare o modificare manualmente le directory installate.

## Purpose

This repository stores n8n workflow definitions for the homelab n8n instance.
The goal is to make workflows reviewable in Git and importable into the
Kubernetes installation managed from the `homelab` GitOps repository.

Default collaboration language is Italian unless the user asks otherwise. Keep
file names, commands, commit messages, and technical identifiers in English.

## Default Workflow

Before changing workflow files, scripts, or GitOps integration documents:

1. Read `AGENTS.md`, `README.md`, `CONTEXT.md`, and any relevant Active document.
   Dated handoffs under `docs/` are historical context unless explicitly marked
   Active and must not override current manifests or repository-level sources.
2. Check `git status` before editing.
3. Treat workflow JSON as executable automation, not passive data.
4. Inspect workflow JSON for secrets before committing.
5. Keep credentials, tokens, and variable values out of Git.
6. Use `grill-with-docs` for architecture, workflow ownership, or deployment
   model changes.
7. Use `writing-plans` for multi-step implementation plans.
8. Use `systematic-debugging` before fixing unexplained import, publication, or
   runtime failures.
9. Use `verification-before-completion` before claiming an import, validation,
   or deployment path works.
10. Suggest Conventional Commit messages at the end of implementation work.

## Repository Boundaries

- This repository owns exported n8n workflow JSON and local export helpers.
- The `homelab` repository owns Kubernetes, ArgoCD, SOPS, CNPG, HTTPRoute, and
  runtime deployment manifests, including the workflow importer Job.
- Do not add Kubernetes secrets to this repository.
- Do not store n8n API keys, GitHub tokens, credential values, OAuth tokens, or
  webhook secrets in this repository.
- Do not assume n8n Source Control is available or unavailable. The current
  entitlement must be verified on the live installation before licensing is
  used as a design constraint.

## Workflow JSON Rules

- Store workflow files under `workflows/`.
- Prefer one workflow per file.
- Run `find workflows -type f -name '*.json' -print0 | xargs -0 -r -n1 jq empty` before committing workflow changes.
- Review exported credential names and IDs before committing. IDs are not secret
  by themselves, but names can reveal sensitive systems or accounts.
- In n8n 2.x describe runtime state as published/unpublished. Treat the legacy
  JSON `active` field as serialization compatibility, not the preferred runtime
  terminology.

## Integration Rules

- Durable Kubernetes changes belong in
  `/home/iingenito/projects/personal/homelab`.
- The deployed import mechanism is a GitOps-managed Kubernetes Job that uses the
  same n8n image and database environment as the live n8n deployment.
- `n8n import:workflow` makes imported workflows unpublished by default. The
  current Homelab importer snapshots which Git-managed workflows were already
  published before import and runs `publish:workflow` for those IDs afterwards.
  New workflows remain unpublished until their first explicit runtime
  publication.
- Do not equate restored database publication state with an updated live
  runtime. Upstream Server CLI behavior requires a restart for
  `publish:workflow` changes to take effect in a running n8n process, and
  non-multi-main imports can leave previously active cron triggers running until
  restart.
- The live publication-state preservation above is current behavior, not a
  permanent invariant. Wave #33 Task 9 is responsible for reevaluating whether
  native/upstream ownership can replace it with less complexity.

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

This project is indexed by GitNexus as **n8n-workflows** (209 symbols, 344 relationships, 17 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

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
