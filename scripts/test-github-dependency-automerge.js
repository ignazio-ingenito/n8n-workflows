#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, 'workflows', 'github-dependency-automerge.json');

assert.ok(fs.existsSync(workflowPath), 'workflow github-dependency-automerge.json must exist');

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const policyNode = workflow.nodes.find((node) => node.name === 'Evaluate PR eligibility');
const mergeNode = workflow.nodes.find((node) => node.name === 'Merge PR with head SHA');

assert.ok(policyNode, 'Evaluate PR eligibility node must exist');
assert.equal(policyNode.type, 'n8n-nodes-base.code');
assert.equal(policyNode.parameters.mode, 'runOnceForAllItems');
assert.ok(mergeNode, 'Merge PR with head SHA node must exist');
assert.match(mergeNode.parameters.url, /pulls\/\{\{\$json\.number\}\}\/merge$/);
assert.match(mergeNode.parameters.jsonBody, /"sha": "\{\{\$json\.expectedHeadSha\}\}"/);
assert.match(mergeNode.parameters.jsonBody, /"merge_method": "\{\{\$json\.mergeMethod\}\}"/);

function evaluate(pullRequests) {
  const payload = { data: { search: { nodes: pullRequests } } };
  const script = `(function () {\n${policyNode.parameters.jsCode}\n})()`;
  return vm.runInNewContext(script, {
    $input: { all: () => [{ json: payload }] },
  });
}

function basePr(overrides = {}) {
  return {
    number: 42,
    title: 'chore(deps): update example to v1.3.0',
    body: '| Package | Update | Change |\n|---|---|---|\n| example | minor | `v1.2.0` → `v1.3.0` |',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    headRefName: 'renovate/example-1.x',
    headRefOid: 'abc123',
    author: { login: 'renovate[bot]' },
    labels: { nodes: [] },
    reviewDecision: null,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    repository: {
      nameWithOwner: 'ignazio-ingenito/example',
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
    },
    ...overrides,
  };
}

function eligible(pr) {
  return evaluate([pr]);
}

{
  const result = eligible(basePr());
  assert.equal(result.length, 1);
  assert.equal(result[0].json.updateType, 'minor');
  assert.equal(result[0].json.mergeMethod, 'squash');
  assert.equal(result[0].json.expectedHeadSha, 'abc123');
}

{
  const pr = basePr({
    title: 'chore(deps): bump actions/checkout from 7.0.0 to 7.0.1',
    body: 'Dependabot update',
    headRefName: 'dependabot/github_actions/actions/checkout-7.0.1',
    author: { login: 'dependabot[bot]' },
  });
  const result = eligible(pr);
  assert.equal(result.length, 1);
  assert.equal(result[0].json.updateType, 'patch');
}

{
  const pr = basePr({
    title: 'chore(deps): bump lib from 1.2.0 to 1.3.0',
    body: 'Dependabot update',
    headRefName: 'dependabot/npm_and_yarn/lib-1.3.0',
    author: { login: 'dependabot[bot]' },
  });
  assert.equal(eligible(pr)[0].json.updateType, 'minor');
}

{
  const pr = basePr({
    body: '| Package | Update | Change |\n|---|---|---|\n| example | major | `v1.2.0` → `v2.0.0` |',
  });
  assert.equal(eligible(pr).length, 0, 'major update must stay manual');
}

{
  const pr = basePr({ author: { login: 'ignazio-ingenito' }, headRefName: 'feature/manual' });
  assert.equal(eligible(pr).length, 0, 'human PR must be ignored');
}

{
  const pr = basePr({ isDraft: true });
  assert.equal(eligible(pr).length, 0, 'draft PR must be ignored');
}

{
  const pr = basePr({ title: 'Configure Renovate', headRefName: 'renovate/configure' });
  assert.equal(eligible(pr).length, 0, 'Renovate onboarding must be ignored');
}

{
  const pr = basePr({
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
  });
  assert.equal(eligible(pr).length, 0, 'failed checks must block merge');
}

{
  const pr = basePr({
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
  });
  assert.equal(eligible(pr).length, 0, 'pending checks must block merge');
}

{
  const pr = basePr({ mergeable: 'CONFLICTING' });
  assert.equal(eligible(pr).length, 0, 'conflicting PR must be ignored');
}

{
  const pr = basePr({ mergeStateStatus: 'BLOCKED' });
  assert.equal(eligible(pr).length, 0, 'blocked PR must be ignored');
}

{
  const pr = basePr({
    title: 'chore(deps): bump vulnerable-lib from 3.4.0 to 4.0.0',
    body: 'Dependabot security update',
    headRefName: 'dependabot/npm_and_yarn/vulnerable-lib-4.0.0',
    author: { login: 'dependabot[bot]' },
    labels: { nodes: [{ name: 'security' }] },
  });
  const result = eligible(pr);
  assert.equal(result.length, 1, 'security update is eligible even across a major version');
  assert.equal(result[0].json.updateType, 'security');
}

{
  const pr = basePr({
    body: '| Package | Update | Change |\n|---|---|---|\n| example | digest | `sha256:aaa` → `sha256:bbb` |',
  });
  assert.equal(eligible(pr)[0].json.updateType, 'digest');
}

{
  const pr = basePr({
    title: 'chore(deps): bump strange-package',
    body: 'Unclassifiable dependency update',
    headRefName: 'dependabot/npm_and_yarn/strange-package',
    author: { login: 'dependabot[bot]' },
  });
  assert.equal(eligible(pr).length, 0, 'unknown update type must fail closed');
}

{
  const pr = basePr({ reviewDecision: 'CHANGES_REQUESTED' });
  assert.equal(eligible(pr).length, 0, 'requested changes must block merge');
}

{
  const pr = basePr({ reviewDecision: 'REVIEW_REQUIRED' });
  assert.equal(eligible(pr).length, 0, 'required review must block merge');
}

{
  const pr = basePr({
    repository: {
      nameWithOwner: 'other-owner/example',
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
    },
  });
  assert.equal(eligible(pr).length, 0, 'PR outside owner scope must be ignored');
}

{
  const pr = basePr({
    repository: {
      nameWithOwner: 'ignazio-ingenito/example',
      mergeCommitAllowed: true,
      squashMergeAllowed: false,
      rebaseMergeAllowed: true,
    },
  });
  assert.equal(eligible(pr)[0].json.mergeMethod, 'merge');
}

{
  const pr = basePr({
    repository: {
      nameWithOwner: 'ignazio-ingenito/example',
      mergeCommitAllowed: false,
      squashMergeAllowed: false,
      rebaseMergeAllowed: false,
    },
  });
  assert.equal(eligible(pr).length, 0, 'PR with no allowed merge method must be ignored');
}

console.log('OK github dependency automerge policy');
