# Workflow n8n

Questo repository raccoglie i workflow n8n in formato JSON. L'obiettivo è
tenerli sotto versionamento e importarli, quando serve, nell'istanza n8n
dell'homelab tramite un Job Kubernetes gestito via GitOps.

Il repository resta separato da `homelab` per una ragione pratica: i workflow
cambiano più spesso dei manifest infrastrutturali, e conviene revisarli senza
mescolarli al codice Kubernetes.

## Struttura

```text
workflows/  Workflow n8n esportati in JSON, uno per file.
credentials/ Export credenziali n8n non decrittati, cifrati con SOPS.
docs/       Note operative, piani e handoff.
scripts/    Script locali di validazione.
```

## Target attuale

- istanza n8n: `https://n8n.skunklabs.uk`
- base URL dei webhook: `https://hooks.skunklabs.uk`
- namespace Kubernetes: `apps`
- manifest homelab: `/home/iingenito/projects/personal/homelab/gitops/apps/n8n`
- immagine n8n osservata nel cluster il 2026-06-11: `n8nio/n8n:2.26.2`
- persistenza: PostgreSQL via CNPG più PVC `n8n-data`

## Regole per i workflow

- Prima di committare un JSON, controlla che non contenga token, header
  sensibili, password, segreti webhook, dati personali o endpoint privati.
- Credenziali e valori di variabili restano in n8n o nei Secret Kubernetes
  gestiti con SOPS. Non vanno nei file JSON.
- Metti i workflow in `workflows/`, preferibilmente un file per workflow.
- Usa nomi stabili e descrittivi, per esempio `daily-report.json`.
- L'import lascia i workflow inattivi. L'attivazione si fa manualmente dalla UI
  di n8n.
- Se serve un backup versionato delle credenziali, usa solo export non
  decrittati e cifrali con SOPS sotto `credentials/*.enc.json`.
- Non committare mai export credentials con `--decrypted`.

## Export dal live

Con kubeconfig funzionante:

```bash
./scripts/export-live.sh
```

Il comando salva un export read-only sotto `tmp/live-export-*` per la review.
Per aggiornare il repository dopo la review:

```bash
./scripts/export-live.sh --apply
```

`--apply` copia i workflow in `workflows/` forzando `active: false`, poi cifra
subito gli export credentials non decrittati in `credentials/*.enc.json`.

Per un restore drill, decritta gli export credentials solo in una directory
temporanea fuori dal repository e importali da lì.

## Baialupo approval flow

Per Baialupo il repository contiene anche un workflow di approvazione via
Telegram e una pagina di approvazione su `hooks.skunklabs.uk`:

- Codex prepara fino a 5 candidati e li invia al webhook
  `baia/telegram/shortlist`. Il payload deve includere anche `chat_id`, così n8n
  può mandare la notifica Telegram senza leggere env vars nel Code node.
- Ogni candidato deve includere almeno `path`, `title`, `slug` e `content`;
  `expires` è opzionale.
- n8n manda la shortlist su Telegram come notifica, poi espone una pagina di
  approvazione su `hooks.skunklabs.uk/webhook/baia/telegram/approve?runId=...`.
- La pagina mostra numero, titolo e descrizione breve. Il titolo è il link di
  approvazione: cliccandolo si sceglie direttamente quell'articolo.
  La shortlist pendente è salvata in una Data Table n8n e richiamata per
  `runId`, quindi la pagina non dipende da stato volatile tra esecuzioni.
- n8n riscrive il markdown del solo articolo scelto con `featured: 1` e
  committa quel file su `baialupo.com`. Gli altri candidati vengono ignorati.
- Il workflow usa una credenziale Telegram configurata in n8n; il repository
  non contiene token o segreti del bot.
- Alla fine dispatcha il workflow `deploy.yaml` del repo Baialupo e risponde
  con il link pubblico dell'articolo.
- Un secondo workflow schedulato controlla i post già pubblicati e demota a
  `featured: 0` quelli con `expires` scaduto.

## Job Search Radar

`workflows/job-search-radar.json` recupera annunci pubblici da Remotive,
Arbeitnow e RemoteOK, li normalizza e produce un report Markdown/JSON
nell'output del workflow. La logica strategica di profilo, role family, query
seed e scoring non vive qui: resta come source of truth nel repo
`/home/iingenito/projects/personal/resume`.

`workflows/job-search-email-alerts.json` legge gli alert email di lavoro
arrivati su Gmail, inclusi LinkedIn e Indeed, estrae titolo/link/testo e applica
lo stesso flusso operativo. Il workflow non fa scraping LinkedIn: la raccolta
passa da ricerche salvate e job alert.

Il workflow non contiene credenziali. Dopo l'import puoi configurare nel nodo
`Delivery Settings` una `deliveryWebhookUrl` per inviare il report a un endpoint
esterno, oppure un `telegramChatId` per inviare un digest Telegram. Se entrambi
restano vuoti, il workflow passa dal nodo `No Delivery Configured` e produce
comunque il report nell'esecuzione n8n, con `deliveryStatus: skipped`. Per
Telegram va associata manualmente la credenziale Telegram al nodo
`Send Report to Telegram` dopo l'import.

Per il workflow email va associata manualmente una credenziale Gmail ai nodi
`Scan Job Alert Emails` e `Get Alert Email` dopo l'import.

Per usare Telegram anche sugli alert email, configura `telegramChatId` nel nodo `Delivery Settings` di `Job Search Email Alerts` e associa la credenziale Telegram al nodo `Send Report to Telegram`. Il workflow email usa le stesse esclusioni operative del radar pubblico per Product Engineer standalone e modelli non permanent.

Source of truth strategica:

```text
/home/iingenito/projects/personal/resume/profile/positioning.md
/home/iingenito/projects/personal/resume/profile/target-roles.md
/home/iingenito/projects/personal/resume/job-search/market-observatory-spec.md
/home/iingenito/projects/personal/resume/job-search/linkedin-query-seeds.md
/home/iingenito/projects/personal/resume/job-search/italy-market-sources.md
/home/iingenito/projects/personal/resume/job-search/scoring-model.md
/home/iingenito/projects/personal/resume/automations/n8n-workflows.md
```

Handoff operativo:

```text
docs/2026-06-11-job-search-radar-handoff.md
```

## Validazione

```bash
./scripts/validate-workflows.sh
```

## Prossimo handoff

Parti da qui:

```text
docs/2026-05-29-n8n-workflows-gitops-handoff.md
```
