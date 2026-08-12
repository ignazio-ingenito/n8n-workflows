# GitHub Dependency PR Auto Merge

Workflow: `workflows/github-dependency-automerge.json`.

## Policy

Il workflow controlla le PR aperte nei repository owned by `ignazio-ingenito` e considera solo:

- autore `renovate[bot]` con branch `renovate/*`;
- autore `dependabot[bot]` con branch `dependabot/*`;
- PR non draft;
- PR `MERGEABLE` con `mergeStateStatus=CLEAN`;
- status check rollup `SUCCESS`;
- nessuna review `CHANGES_REQUESTED` o `REVIEW_REQUIRED`;
- update `patch`, `minor`, `digest` o `security`.

Restano manuali:

- major update;
- Renovate onboarding / `Configure Renovate`;
- PR umane;
- update non classificabili con certezza;
- PR senza metodo di merge consentito dal repository.

La policy e' fail-closed: un caso ambiguo viene ignorato.

## Merge e race safety

Il workflow usa il REST endpoint GitHub `PUT /repos/{owner}/{repo}/pulls/{number}/merge` solo dopo il gate. Nel body passa `sha` uguale alla head SHA osservata durante la valutazione. Se la head cambia prima del merge, GitHub rifiuta l'operazione invece di mergiare una revisione diversa da quella verificata.

Il metodo preferito e' `squash`; se il repository non lo consente usa `merge`, quindi `rebase`. Se nessun metodo e' consentito la PR viene ignorata.

## Runtime

Il workflow e' versionato con `active: false` e viene importato tramite il normale flusso GitOps n8n. Dopo l'import:

1. verificare che il credential stub `GitHub account` punti alla credenziale GitHub runtime corretta;
2. la credenziale deve poter leggere PR/check e mergiare PR nei repository target;
3. attivare il workflow dalla UI n8n quando si vuole rendere operativo l'automerge.

Il trigger schedulato esegue il controllo ogni 15 minuti.

## Validazione

```bash
./scripts/validate-workflows.sh
node ./scripts/test-github-dependency-automerge.js
```
