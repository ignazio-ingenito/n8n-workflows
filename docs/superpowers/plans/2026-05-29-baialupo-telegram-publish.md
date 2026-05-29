# Baialupo Telegram Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new n8n workflow that receives a Baialupo shortlist, sends it to Telegram for numbered approval, publishes the selected article by toggling `featured`, commits the updated markdown to `baialupo.com`, triggers the Aruba deploy pipeline, and sends back the final article URL. A separate scheduled workflow demotes expired featured articles.

**Architecture:** Keep the workflow narrow and stateful only where needed. The shortlist generation stays external, and n8n only orchestrates intake, Telegram approval, markdown rewrites, GitHub commits, and deployment. Use the article frontmatter `expires` field as metadata for a separate cleanup workflow that scans published posts and demotes expired featured articles.

**Tech Stack:** n8n workflow JSON, Telegram app node, Webhook trigger, JavaScript Code nodes, GitHub REST API, GitHub Actions workflow dispatch, Baialupo markdown/frontmatter conventions.

---

### Task 1: Add the approval-driven workflow JSON

**Files:**
- Create: `workflows/baialupo-telegram-publish.json`

- [ ] **Step 1: Model the input contract**

```json
{
  "run_id": "baialupo-2026-05-29-001",
  "candidates": [
    {
      "path": "src/content/posts/news/2026-05-29-example.md",
      "title": "Example title",
      "slug": "example",
      "expires": "2026-06-05",
      "content": "---\ntitle: \"Example title\"\ncategory: news\nfeatured: 0\ncreated: 2026-05-29T08:00:00\nupdated: 2026-05-29T08:00:00\ncreated_by: Ignazio\nexpires: 2026-06-05\n---\n\nBody markdown here.\n"
    }
  ]
}
```

- [ ] **Step 2: Build the workflow nodes**

Create a workflow with:

1. a `Webhook` trigger that receives the shortlist payload from Codex;
2. a `Telegram` send step that posts the numbered shortlist to a fixed chat id from an environment variable;
3. a `Telegram Trigger` branch that listens for the numeric reply from the same operator;
4. a `Code` node that resolves the selected candidate and rewrites `featured: 1` for the chosen article only;
5. a `Code` node that keeps the `expires` metadata intact in the rewritten markdown;
6. an `HTTP Request` node that commits the changed markdown to the `baialupo.com` GitHub repo;
7. an `HTTP Request` node that dispatches `baialupo.com/.github/workflows/deploy.yaml`;
8. a final Telegram message with the public article URL built from the article slug.

- [ ] **Step 3: Add validation and safety checks**

Add checks in Code nodes for:

```js
if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 5) {
  throw new Error("Expected 1 to 5 candidates");
}

if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) {
  throw new Error("Invalid article number");
}
```

Keep the workflow inactive in the JSON and avoid hardcoding secrets, tokens, or chat ids.

### Task 2: Document the workflow contract and expiry metadata

**Files:**
- Modify: `README.md`
- Modify: `docs/2026-05-29-n8n-workflows-gitops-handoff.md`

- [ ] **Step 1: Document the new approval flow**

Add a short section that explains:

```text
Baialupo approval flow:
- Codex prepares up to 5 candidate articles and POSTs them to the workflow webhook.
- n8n sends the shortlist to Telegram.
- A numeric reply chooses the article to publish.
- The workflow rewrites featured flags, commits to baialupo.com, dispatches deploy, and replies with the final URL.
```

- [ ] **Step 2: Document the expiry metadata**

Add a note that generated Baialupo articles may include an `expires` frontmatter field for later demotion to `featured: 0`, and that a separate scheduled workflow performs that demotion.

### Task 3: Validate the repo changes

**Files:**
- None

- [ ] **Step 1: Validate workflow JSON**

Run:

```bash
./scripts/validate-workflows.sh
```

Expected: the new workflow JSON parses and the repo contains no secret material in the workflow export.

- [ ] **Step 2: Inspect the diff for accidental secret leakage**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors, and only the intended workflow/doc files are changed.
