# Job Search Radar n8n Handoff

Date: 2026-06-11

## Goal

Create an n8n workflow that periodically retrieves public job listings and ranks
them against Ignazio Ingenito's job-search strategy.

The strategic source of truth for profile positioning, role families, query
seeds, scoring and market-observatory rules lives in the `resume` repository,
not here:

- `/home/iingenito/projects/personal/resume/profile/positioning.md`
- `/home/iingenito/projects/personal/resume/profile/target-roles.md`
- `/home/iingenito/projects/personal/resume/job-search/market-observatory-spec.md`
- `/home/iingenito/projects/personal/resume/job-search/linkedin-query-seeds.md`
- `/home/iingenito/projects/personal/resume/job-search/italy-market-sources.md`
- `/home/iingenito/projects/personal/resume/job-search/scoring-model.md`
- `/home/iingenito/projects/personal/resume/automations/n8n-workflows.md`

This repository only carries the workflow JSON, the import/activation notes,
and the UI credential bindings needed by n8n.

## Cluster Context

- n8n namespace: `apps`
- n8n service: `n8n.apps.svc.cluster.local:5678`
- n8n UI: `https://n8n.skunklabs.uk`
- webhook host: `https://hooks.skunklabs.uk`
- live image observed on 2026-06-11: `n8nio/n8n:2.26.2`
- import path: ArgoCD-managed `n8n-workflows` importer job
- import command: `n8n import:workflow --separate --input=/workflow-source/n8n-workflows/workflows`

## Workflow

Files:

```text
workflows/job-search-radar.json
workflows/job-search-email-alerts.json
```

Workflow names:

```text
Job Search Radar
Job Search Email Alerts
```

Both workflows are intentionally committed with `active: false`. Import should
not activate them automatically. Activation stays manual in the n8n UI.

## Data Flow

```text
Manual Trigger / Schedule Trigger
  -> Fetch Remotive
  -> Fetch Arbeitnow
  -> Fetch RemoteOK
  -> Rank Job Listings
  -> Delivery Settings
  -> Has Delivery Webhook?
     true  -> Send Report Webhook
     false -> No Delivery Configured -> output report only

Gmail Trigger
  -> Get Alert Email
  -> Parse and Score Alerts
  -> Delivery Settings
  -> Has Delivery Webhook?
     true  -> Send Report Webhook
     false -> No Delivery Configured -> output report only
```

## Operational Notes

- Sources: Remotive API, Arbeitnow API, RemoteOK API, LinkedIn job-alert emails
  through Gmail, and other job-alert emails through the same Gmail intake.
- These are public endpoints or alert-based sources and do not require
  credentials on the source side.
- If one source fails, the current workflow execution fails at that node; a
  later hardening pass can enable per-source `continueOnFail` and include
  source-level error reporting.
- The email-alert workflow requires a Gmail credential attached in the n8n UI
  after import. The workflow JSON intentionally does not commit any credential
  reference.
- Do not scrape LinkedIn directly. Use saved searches and job alerts, then let
  n8n read the alert emails.
- The detailed ranking model, role family boundaries and query seed set remain
  in the `resume` repository and are not duplicated here.
- The workflow Code nodes contain an implementation snapshot of that strategy
  so the imported workflows can run without reading local files at runtime. If
  strategy changes, update `resume` first, then mirror the relevant operational
  change into the workflow JSON.

## Scoring Calibration

The public-feed radar applies title-first gating before ranking. Broad body text
keywords such as startup, platform, team, product, AI, or governance are not
enough to promote an announcement when the title is clearly out of scope.
Internship/student roles, sales-only roles, marketing/CRM roles, recruiting,
PMO-only roles, and plain senior-developer titles are hard penalized or filtered
out unless the title also contains a target technical leadership signal.

Current calibration also treats standalone Product Engineer / full-stack IC roles as out of scope unless they carry explicit leadership, architecture, platform or founding ownership signals. Freelance, contractor, independent, talent-network, marketplace and staff-augmentation models are excluded before scoring because the active search target is permanent employment.

Arbeitnow and RemoteOK feed prefilters intentionally match query terms against
titles only. Remotive remains broader at ingest time, then relies on scoring and
recommendedAction to keep non-target roles out of top matches.

## Delivery

The workflow does not commit any email, Telegram, Slack, or API credential. Telegram delivery uses a Telegram node credential attached manually in the n8n UI.

To send either report somewhere after import:

1. Open `Job Search Radar` or `Job Search Email Alerts` in n8n.
2. Edit node `Delivery Settings`.
3. Set `deliveryWebhookUrl` to the endpoint that should receive the JSON payload, or set `telegramChatId` to send a compact Telegram digest instead. If both are set, webhook delivery wins.

   ```json
   {
     "generatedAt": "...",
     "totalFetched": 123,
     "dedupedCount": 123,
     "matchCount": 10,
     "minPriorityScore": 40,
     "sourceCounts": {},
     "familySummary": {},
     "excludedSummary": {},
     "topMatches": [],
     "monitorQueue": [],
     "markdown": "..."
   }
   ```

4. Activate the workflow manually.

`Job Search Radar` deliberately omits full `records` descriptions from the
delivery payload to keep executions readable; review `excludedSummary`, compact
`topMatches`, and `monitorQueue` for triage. `Job Search Email Alerts` uses the
older email-alert shape and reports `parsedCount` and `matches` instead of
`totalFetched` and `topMatches`.

If `deliveryWebhookUrl` is empty and `telegramChatId` is set, the workflow routes through `Send Report to Telegram` and returns the report with `deliveryStatus: sent_telegram`. If both are empty, it routes through `No Delivery Configured` and still returns a ranked report in the execution output with `deliveryStatus: skipped`.

For `Job Search Radar`, attach the Telegram credential to `Send Report to Telegram` when using Telegram delivery.

The Telegram digest is generated as plain text: the formatter strips HTML tags and decodes common HTML entities before passing the text to the Telegram node. Keep Telegram `parseMode` unset. If the n8n UI exposes an attribution toggle for this node, do not use it as a formatting workaround; the workflow message should remain valid with no Telegram markup parsing.

For `Job Search Email Alerts`, also attach the Gmail OAuth credential to:

- `Scan Job Alert Emails`
- `Get Alert Email`

`Job Search Email Alerts` can also deliver the compact digest to Telegram. Configure `telegramChatId` in `Delivery Settings` and attach the Telegram credential to `Send Report to Telegram`. Webhook delivery still wins when `deliveryWebhookUrl` is set. The email workflow uses the same current calibration as the public radar: standalone Product Engineer/full-stack IC roles and non-permanent engagement models are filtered before scoring.

## Verification

Local repository validation:

```bash
./scripts/validate-workflows.sh
```

Cluster visibility after GitOps import:

```bash
kubectl exec -n apps deploy/n8n -- n8n list:workflow
```

Manual n8n check:

- Open `https://n8n.skunklabs.uk`.
- Confirm `Job Search Radar` and `Job Search Email Alerts` exist.
- Confirm both are inactive after import.
- Execute manually once.
- Review the output of `Rank Job Listings` and `Parse and Score Alerts`.

## Residual Risks

- Public job APIs can change shape or rate-limit requests.
- Scoring is deterministic keyword matching, not semantic matching.
- Role family and seniority are inferred from title plus supporting text
  signals; ambiguous records still need manual review.
- Delivery is deliberately not wired to a credentialed channel yet.
- Gmail alert parsing depends on sender-specific email formats; expect tuning
  after the first real LinkedIn/Indeed alerts arrive.
