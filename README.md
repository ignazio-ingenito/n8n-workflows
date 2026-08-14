# Workflow n8n

**Status:** Active

Questo repository raccoglie i workflow n8n in formato JSON. L'obiettivo è
tenerli sotto versionamento e importarli, quando serve, nell'istanza n8n
dell'homelab tramite un Job Kubernetes gestito via GitOps.

Il repository resta separato da `homelab` per una ragione pratica: i workflow
cambiano più spesso dei manifest infrastrutturali, e conviene revisarli senza
mescolarli al codice Kubernetes.

Il comportamento runtime dell'importer non è definito qui: la fonte autorevole è
`ignazio-ingenito/homelab`, in particolare
`gitops/apps/n8n-workflows/import-job.yaml` e
`doc/28-n8n-workflow-gitops-importer.md`.

## Struttura

```text
workflows/  Workflow n8n esportati in JSON, uno per file.
credentials/ Export credenziali n8n non decrittati, cifrati con SOPS.
docs/       Note operative, piani e handoff storici.
scripts/    Script operativi di export.
```

## Target attuale

- istanza n8n: `https://n8n.skunklabs.uk`
- base URL dei webhook: `https://hooks.skunklabs.uk`
- namespace Kubernetes: `apps`
- deployment n8n: `homelab/gitops/apps/n8n/deployment.yaml`
- importer workflow: `homelab/gitops/apps/n8n-workflows/import-job.yaml`
- immagine n8n: definita esclusivamente dal Deployment in `homelab`, senza
  duplicarne qui il tag corrente
- persistenza: PostgreSQL via CNPG più PVC `n8n-data`
- entitlement n8n Source Control: **non verificato**; il check live tentato in
  Wave #33 Task 9 è rimasto bloccato da indisponibilità del cluster. Non
  assumere disponibile o indisponibile finché non esiste nuova evidenza live.

## Regole per i workflow

- Prima di committare un JSON, controlla che non contenga token, header
  sensibili, password, segreti webhook, dati personali o endpoint privati.
- Credenziali e valori di variabili restano in n8n o nei Secret Kubernetes
  gestiti con SOPS. Non vanno nei file JSON.
- Metti i workflow in `workflows/`, preferibilmente un file per workflow.
- Usa nomi stabili e descrittivi, per esempio `daily-report.json`.
- In n8n 2.x usa i termini **published/unpublished** per lo stato runtime. Il
  campo JSON legacy `active` può ancora comparire negli export.
- `n8n import:workflow` rende i workflow importati unpublished per default.
  L'importer Homelab corrente fotografa prima dell'import quali workflow
  presenti in Git risultano già published e, dopo l'import, esegue
  `publish:workflow` soltanto per quelli. I workflow nuovi restano quindi
  unpublished al primo import; la prima pubblicazione resta una decisione
  runtime manuale.
- La preservazione corrente è soprattutto **stato persistito nel DB**. La
  documentazione upstream del Server CLI specifica che `publish:workflow`
  eseguito mentre n8n è in funzione richiede un restart perché il cambiamento
  abbia effetto nel processo. Inoltre, sulle istanze non multi-main i cron
  precedentemente attivi possono restare in esecuzione dopo un import fino al
  restart. Di conseguenza, ripristinare lo stato published nel DB non prova che
  la nuova definizione importata sia già quella eseguita dal runtime.
- Wave #33 Task 9 ha concluso **KEEP minimo** dell'importer corrente: rimuoverlo
  eliminerebbe il percorso operativo Git → database n8n e nessun replacement
  equivalente è stato verificato nell'installazione corrente. Il caveat sullo
  stato live resta esplicito e non va coperto con ulteriore custom; rivalutare
  l'owner solo quando esiste nuova evidenza live o una capability upstream
  cambiata.
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

`--apply` copia i workflow in `workflows/` forzando il campo legacy
`active: false`, poi cifra subito gli export credentials non decrittati in
`credentials/*.enc.json`. Questo normalizza il contenuto versionato e non
descrive da solo lo stato published steady-state: l'importer Homelab corrente
gestisce separatamente la preservazione dello stato persistito dei workflow già
published.

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
esterno, un `digestEmailTo` per inviare un digest via Gmail, oppure un
`telegramChatId` per inviare un digest Telegram. La priorità è webhook, email,
poi Telegram. Se tutti restano vuoti, il workflow passa dal nodo `No Delivery Configured` e produce
comunque il report nell'esecuzione n8n, con `deliveryStatus: skipped`. Per
Telegram va associata manualmente la credenziale Telegram al nodo
`Send Report to Telegram` dopo l'import. Per il digest email va associata
manualmente una credenziale Gmail al nodo `Send Digest Email`.

`Job Search Email Alerts` conserva anche la query dell'alert LinkedIn su ogni
record come `alertQuery` e produce `queryHealth`, una sintesi per gruppo
canonico di query. Alias equivalenti, per esempio `CTO` e `Chief Technology
Officer`, vengono aggregati nello stesso gruppo mantenendo i nomi originali in
`aliases`. La sezione riporta conteggio job, segnali utili, narrative fit,
rumore e raccomandazione operativa (`keep`, `observe`, `narrow`,
`retire_candidate`). La stessa sezione appare nei digest email e Telegram per
capire quali alert conviene tenere, restringere o eliminare.

La memoria storica delle query vive nella Data Table n8n
`job_alert_query_history`: il workflow crea la tabella se manca, salva una riga
per query/ciclo e calcola le raccomandazioni sugli ultimi 5 cicli per query.
Per rifare un test senza contaminare il primo ciclo reale, svuota manualmente
questa Data Table dalla UI n8n prima di rilanciare il workflow.

Per il workflow email va associata manualmente una credenziale Gmail al nodo
`Scan Job Alert Emails` dopo l'import. Il nodo scansiona le email non lette
correnti, quindi copre anche il backlog unread entro il limite configurato.

Per usare il digest email sugli alert email, configura `digestEmailTo` nel nodo
`Delivery Settings` di `Job Search Email Alerts` e associa la credenziale Gmail
al nodo `Send Digest Email`. Per usare Telegram, configura `telegramChatId` e
associa la credenziale Telegram al nodo `Send Report to Telegram`. Il workflow
email usa le stesse esclusioni operative del radar pubblico per Product Engineer
standalone e modelli non permanent. Esclude anche i ruoli UK/Regno Unito senza
indicazione esplicita di visa sponsorship o supporto visto, usando
`uk_requires_sponsorship` prima dello scoring. Le email LinkedIn di recommended
jobs sono accettate nello stesso flusso, ma i suggerimenti senza titolo target o
famiglia ruolo target riconoscibile sono esclusi con `low_signal_public_feed` e
non alimentano `queryHealth`, che resta riservato agli alert salvati.

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

Il documento `docs/2026-06-11-job-search-radar-handoff.md` è un handoff storico:
può essere usato per ricostruire il contesto, non come fonte corrente del
comportamento dell'importer.

## Validazione

```bash
find workflows -type f -name '*.json' -print0 | xargs -0 -r -n1 jq empty
```

## Runtime GitOps

Per il comportamento corrente dell'importer usa la fonte Homelab:

```text
ignazio-ingenito/homelab
  gitops/apps/n8n-workflows/import-job.yaml
  doc/28-n8n-workflow-gitops-importer.md
```

`docs/2026-05-29-n8n-workflows-gitops-handoff.md` descrive il progetto iniziale
dell'importer ed è contesto storico; non va usato per dedurre lo stato runtime
corrente.

## Harbor scan alerts

`workflows/harbor-scan-alerts.json` riceve CloudEvents Harbor sul path
`/webhook/harbor-scans` e inoltra a `#harbor-security` soltanto
`harbor.scan.failed` e `harbor.scan.completed` con conteggio `HIGH` o
`CRITICAL` maggiore di zero. Le scansioni senza `HIGH`/`CRITICAL` rispondono
con `notified: false` e non attraversano il nodo Slack.

Al primo import un workflow nuovo resta unpublished. Se lo stesso workflow era
già published, l'importer corrente ripristina nel database il relativo stato di
pubblicazione; questo non garantisce da solo che una nuova definizione importata
sia caricata nel processo n8n senza restart. Prima della prima pubblicazione
associa:

- al nodo `Receive Harbor Scan`, la credenziale HTTP Header Auth richiesta dal
  runtime Harbor/n8n corrente; il valore della credenziale non appartiene a
  questo repository e la sua ownership va verificata nella configurazione
  Homelab corrente;
- al nodo `Notify harbor-security`, una credenziale Slack Access Token con
  permesso `chat:write` e accesso al canale `#harbor-security`, selezionando in
  UI il channel ID reale del canale.

Il JSON versiona i credential stub e il channel ID reali esportati dal workflow
live, ma non contiene i valori delle credenziali. Non sostituirli con ID
inventati. Dopo ogni modifica ai binding, esporta nuovamente il workflow live e
versiona gli ID reali prima di considerare conclusa la migrazione.

## UptimeRobot email alerts

`workflows/uptimerobot-email-alerts.json` usa solo nodi standard n8n:
`Gmail Trigger` → normalizzazione → filtro eventi conosciuti → Slack `#uptime` →
cleanup Gmail.

Il workflow:

- osserva le email non lette che corrispondono alla ricerca Gmail `uptimerobot`;
- riconosce `Monitor is DOWN` come DOWN e `Monitor is UP` come recovery;
- inoltra anche notifiche di scadenza SSL/domain quando il contenuto è
  riconoscibile;
- ignora messaggi UptimeRobot con tipo non riconosciuto invece di produrre
  rumore su Slack;
- dopo una consegna Slack riuscita rimuove le label Gmail `UNREAD` e `INBOX`,
  marcando il messaggio come letto e archiviandolo;
- se Slack fallisce, il cleanup Gmail non viene eseguito e il messaggio sorgente
  resta disponibile per troubleshooting/retry;
- viene versionato con il campo legacy `active: false`; al primo import resta
  unpublished. Gli import successivi ripristinano nel DB lo stato published se
  lo era già, con la stessa caveat sul restart del processo descritta sopra.

In n8n associa la stessa credenziale Google/Gmail OAuth2 sia al nodo
`Receive UptimeRobot Gmail` sia al nodo `Mark Read and Archive Gmail`. Il nodo
`Notify uptime` riusa il credential stub `Slack Homelab Alerts` e punta al
channel ID reale `C0BNZQD0EBU`; nessun token OAuth o Slack è presente
nell'export versionato.

Evidenza E2E della Wave `homelab#659` (2026-08-09):

- DOWN reale di `www.skunklabs.uk` → Gmail → n8n → `#uptime`;
- recovery reale → stesso percorso → `#uptime`;
- cleanup verificato sulla mail DOWN: label `INBOX` e `UNREAD` assenti dopo la
  consegna Slack;
- workflow mergiato in `n8n-workflows#3`; merge commit
  `980891b7a9b7970000e373276761cc68ef100077`.
