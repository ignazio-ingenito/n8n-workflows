# Baialupo Approval Page Design

Date: 2026-05-29

## Goal

Replace the direct Telegram reply step in the Baialupo publish flow with a
minimal approval page hosted on `hooks.skunklabs.uk`.

Telegram remains a notification channel only. The approval action happens by
clicking the article title on the approval page, which sends the selected
number back to n8n through a webhook.

## Problem Statement

The current approval flow relies on a `Telegram Trigger` to capture the
operator's numeric reply. In this environment, that activation path is not
reliable enough to keep as the control plane for approval.

We still want the same editorial outcome:

- receive a shortlist of up to 5 candidate articles,
- present them to the operator,
- let the operator pick exactly one article,
- publish only that article with `featured: 1`,
- ignore the other candidates,
- commit the markdown update,
- trigger the Aruba deploy pipeline,
- return the public article URL.

## Decision

Use a webhook-backed approval page on `hooks.skunklabs.uk`.

The page lists the shortlisted candidates with:

- number,
- title,
- very short description.

The title itself is the approval link. Clicking it approves that article
directly. There is no secondary confirmation page and no extra button.

## Architecture

### 1. Shortlist intake workflow

The Baialupo workflow still starts from a webhook receiving the shortlist
payload.

It validates:

- at least 1 candidate,
- at most 5 candidates,
- required fields on each candidate,

It then writes the shortlist to a Data Table row keyed by `runId` and sends a
Telegram message that points to the approval page.

### 2. Approval page on `hooks.skunklabs.uk`

The approval page is served by n8n through the hooks domain.

It renders the shortlist loaded from the Data Table row as a simple HTML page:

- one row per candidate,
- the candidate number,
- the title as a link,
- a short description.

The page does not expose internal IDs. The approval link only needs the
selected number.

### 3. Approval webhook

The same hooks-backed endpoint receives the approval click.

When the request includes `choice=N` in the query string, the workflow:

- loads the matching Data Table row,
- validates that `N` is in range,
- publishes only the selected article with `featured: 1`,
- ignores the other candidates,
- rewrites the selected markdown file,
- commits the change to `baialupo.com`,
- dispatches the Aruba deploy pipeline,
- sends the final public URL back through Telegram.

## Data Contract

### Inbound shortlist payload

The shortlist webhook accepts a body with:

- `run_id` optional
- `chat_id` optional
- `candidates[]` required

Each candidate must include:

- `path`
- `title`
- `slug`
- `content`

Each candidate may also include:

- `description`
- `expires`

If `description` is missing, the workflow can derive a short fallback snippet
from the article content. The approval page still shows a brief summary.

### Pending approval row

The workflow stores one row per shortlist in a Data Table.

The stored row includes:

- `runId`
- `chatId`
- `status`
- `createdAt`
- `candidatesJson`
- `approvalUrl`
- `message`
- `count`

Each normalized candidate includes:

- `index`
- `path`
- `title`
- `slug`
- `content`
- `description`
- `expires`

## Error Handling

The workflow rejects these cases:

- more than 5 candidates,
- missing required candidate fields,
- approval arrives with a number outside the shortlist range,
- no matching pending Data Table row exists for the requested `runId`.

## Publish Behavior

Only the chosen article is updated to `featured: 1`.

The other shortlisted candidates are ignored. They are not rewritten and are
not committed as part of the publish action.

After the commit:

- the Aruba deploy pipeline is dispatched,
- the workflow reports the final public article URL.

The separate expiry cleanup workflow remains unchanged. It continues to demote
already published featured articles to `featured: 0` when `expires` is in the
past.

## Non-Goals

- No Telegram reply trigger in the approval path.
- No approval login.
- No separate database for shortlist state.
- No public editing of the article content from the approval page.
- No change to the expiry cleanup workflow in this design.

## Testing

The implementation should be verified in this order:

1. Send a synthetic shortlist with 1 to 5 candidates.
2. Confirm the Telegram notification contains the approval page link.
3. Open the approval page and confirm it renders the numbered candidates.
4. Click one title and confirm only that article is published with
   `featured: 1`.
5. Confirm the other candidates are ignored.
6. Confirm the commit lands in `baialupo.com`.
7. Confirm the deploy pipeline runs and the final URL is returned.

## Rollout

1. Update the Baialupo workflow JSON to remove the Telegram reply trigger.
2. Add the hooks-backed approval page and approval webhook.
3. Keep the workflow inactive until the new flow is verified.
4. Run the approval flow with a fake shortlist first.
