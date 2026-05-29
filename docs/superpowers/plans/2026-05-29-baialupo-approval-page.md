# Baialupo Approval Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Baialupo Telegram reply trigger with a hooks-backed approval page where the title itself is the approval link, then publish only the selected article, commit the markdown change, dispatch the deploy pipeline, and return the final URL.

**Architecture:** Keep the Baialupo publish flow in a single n8n workflow so it can keep the approval contract local to one execution. The workflow receives up to 5 candidates, stores the shortlist in an n8n Data Table keyed by `runId`, sends Telegram only as a notification channel, and exposes one hooks-backed approval endpoint that renders HTML when `choice` is absent and processes publication when `choice` is present. This avoids the Telegram trigger activation path entirely while keeping the operator experience to a single click on the article title.

**Tech Stack:** n8n workflow JSON, Webhook trigger, JavaScript Code nodes, Respond to Webhook, Telegram message node, GitHub REST API, GitHub Actions workflow dispatch, Baialupo markdown/frontmatter conventions.

---

### Task 1: Refactor the Baialupo workflow to serve the approval page and process clicks

**Files:**
- Modify: `workflows/baialupo-telegram-publish.json`

- [ ] **Step 1: Replace Telegram reply handling with a hooks approval endpoint**

Update the shortlist intake code so it writes the normalized shortlist to a Data Table row and builds a public approval-page URL keyed by `runId` instead of a Telegram reply prompt. The message sent to Telegram should point to the approval page, not ask for a number reply.

Use this shape for the shortlist state and link generation:

```js
function shortDescription(candidate) {
  if (candidate.description) return candidate.description;

  const body = candidate.content
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return body.slice(0, 140);
}

const normalized = candidates.map((candidate, index) => {
  if (!candidate.path || !candidate.title || !candidate.slug || !candidate.content) {
    throw new Error(`Candidate ${index + 1} is missing path, title, slug or content`);
  }

  return {
    ...candidate,
    index: index + 1,
    description: shortDescription(candidate),
    expires: candidate.expires ?? null,
  };
});

const lines = normalized.map((candidate) => {
  const expiry = candidate.expires ? ` (scade ${candidate.expires})` : '';
  return `${candidate.index}. ${candidate.title}${expiry}`;
});

const message = [
  `Baialupo shortlist ${runId}`,
  '',
  ...lines,
  '',
  `Apri la pagina di approvazione: https://hooks.skunklabs.uk/webhook/baia/telegram/approve?runId=${encodeURIComponent(runId)}`,
  'Clicca il titolo dell articolo da pubblicare.',
  'Il workflow imposterà featured=1 solo sul selezionato e featured=0 sugli altri candidati.',
].join('\n');
```

- [ ] **Step 2: Add a webhook branch that renders the approval page or consumes the click**

Add a new `Webhook` trigger on the same workflow with path `baia/telegram/approve` and `responseMode: responseNode`. Route both cases through the same request shape:

```js
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const request = $('Approve shortlist page').first().json;
const query = request.query ?? {};
const row = $input.first().json;

if (!row) {
  throw new Error('No Baialupo shortlist is waiting for approval');
}

const candidates = JSON.parse(row.candidatesJson ?? '[]');

if (!Array.isArray(candidates) || candidates.length === 0) {
  throw new Error('Invalid Baialupo approval row');
}

if (!query.choice) {
  const rows = candidates.map((candidate) => {
    const href = `https://hooks.skunklabs.uk/webhook/baia/telegram/publish?runId=${encodeURIComponent(row.runId)}&choice=${candidate.index}`;
    return `
      <li>
        <a href="${href}">${escapeHtml(candidate.title)}</a>
        <div>${escapeHtml(candidate.description)}</div>
      </li>
    `;
  }).join('\n');

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Baialupo approval</title></head>
  <body>
    <h1>Baialupo shortlist ${escapeHtml(row.runId)}</h1>
    <ol>${rows}</ol>
  </body>
</html>`;

  return [{ json: { mode: 'page', html, runId: row.runId } }];
}

const choice = Number(query.choice);
if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) {
  throw new Error('Invalid article number');
}

const selected = candidates[choice - 1];
return [{
  json: {
    mode: 'approve',
    choice,
    runId: row.runId,
    chatId: row.chatId,
    ...selected,
    owner: 'ignazio-ingenito',
    repo: 'baialupo.com',
    branch: 'main',
    publicUrl: `https://baialupo.com/${selected.slug}`,
    desiredFeatured: 1,
  },
}];
```

Keep the approval page HTML minimal. The title must be the clickable approval link, and there should be no extra buttons or confirmation step.

Use a `Respond to Webhook` node to return the HTML when `mode === 'page'`, with `Content-Type: text/html; charset=utf-8`.

- [ ] **Step 3: Reuse the existing publish branch for the approved article only**

Keep the markdown rewrite, GitHub commit, deploy dispatch, and confirmation steps, but wire them only to the approved-item branch from the new webhook. The selected article must be rewritten to `featured: 1`; the unselected candidates must remain untouched.

The Data Table row already scopes the approval to one shortlist instance, so
there is no shared pending state to consume. Validate the row, then proceed
directly to the publish branch.

- [ ] **Step 4: Remove the Telegram reply trigger path**

Delete the `Telegram Trigger` node and the `Parse reply` node from `workflows/baialupo-telegram-publish.json`. Keep the Telegram send nodes for notification only. Make sure the approval page link is now the only operator input path.

- [ ] **Step 5: Validate the workflow file**

Run:

```bash
./scripts/validate-workflows.sh
git diff --check
```

Expected: the workflow JSON parses, the file contains no secrets, and there are no whitespace errors.

- [ ] **Step 6: Commit the workflow refactor**

```bash
git add workflows/baialupo-telegram-publish.json
git commit -m "feat(workflows): switch Baialupo approval to hooks page"
```

### Task 2: Update operator docs and the GitOps handoff

**Files:**
- Modify: `README.md`
- Modify: `docs/2026-05-29-n8n-workflows-gitops-handoff.md`

- [ ] **Step 1: Rewrite the Baialupo flow description in the README**

Replace the Telegram-reply description with the hooks approval page flow:

```text
Baialupo approval flow:
- Codex prepares up to 5 candidate articles and POSTs them to the workflow webhook.
- n8n sends the shortlist to Telegram as a notification.
- The approval page on hooks.skunklabs.uk shows number, title, and a short description.
- Clicking the title approves the article directly.
- The workflow rewrites featured flags, commits to baialupo.com, dispatches deploy, and returns the final URL.
```

Keep the expiry note: generated Baialupo articles may include `expires` so the separate cleanup workflow can demote old featured posts to `featured: 0`.

- [ ] **Step 2: Update the handoff to match the new control flow**

Document that:

- Telegram is notification only;
- approval happens through the hooks-backed page;
- the approval link is keyed by `runId`;
- the `Telegram Trigger` is no longer part of the Baialupo approval path.

- [ ] **Step 3: Validate the doc edits**

Run:

```bash
git diff --check
git status --short
```

Expected: only the intended doc files changed, and there are no formatting issues.

- [ ] **Step 4: Commit the docs**

```bash
git add README.md docs/2026-05-29-n8n-workflows-gitops-handoff.md
git commit -m "docs(baialupo): document hooks approval page"
```

### Task 3: Verify the end-to-end approval flow in n8n

**Files:**
- None

- [ ] **Step 1: Import or sync the updated workflow into n8n**

Use the existing GitOps import path from the `homelab` repository. Confirm the workflow remains inactive after import.

- [ ] **Step 2: Send a synthetic shortlist**

POST a fake payload with 1 to 5 candidates to the shortlist webhook. Use a payload shaped like:

```json
{
  "run_id": "baialupo-2026-05-29-001",
  "candidates": [
    {
      "path": "src/content/posts/news/2026-05-29-example.md",
      "title": "Example title",
      "slug": "example",
      "description": "Short preview text",
      "content": "---\ntitle: \"Example title\"\nfeatured: 0\n---\nBody markdown here.\n"
    }
  ]
}
```

Expected: Telegram receives the notification with the approval-page link.

- [ ] **Step 3: Open the approval page and click a title**

Open the `runId`-scoped approval URL from the Telegram message. Confirm the page renders the numbered candidates and the titles are clickable links.

Expected: clicking a title sends the approval request with `choice=N` in the query string, publishes only that article, and leaves the others untouched.

- [ ] **Step 4: Confirm publish side effects**

Verify:

- the markdown file on `baialupo.com` has `featured: 1` only for the selected article;
- the Git commit lands on the repo;
- the deploy pipeline runs;
- Telegram receives the final public URL.
