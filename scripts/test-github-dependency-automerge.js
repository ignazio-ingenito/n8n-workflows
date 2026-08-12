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
assert.ok(policyNode, 'Evaluate PR eligibility node must exist');
assert.equal(policyNode.type, 'n8n-nodes-base.code');
assert.equal(policyNode.parameters.mode, 'runOnceForAllItems');

function evaluate(pullRequests) {
  const payload = {
    data: {
      search: {
        nodes: pullRequests,
      },
    },
  };

  const script = `(function () {\n${policyNode.parameters.jsCode}\n})()`;
  return vm.runInNewContext(script, {
    $input: {
      all: () => [{ json: payload }],
    },
  });
}

function basePr(overrides = {}) {
  return {
    id: 'PR_kwDOexample',
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
    autoMergeRequest: null,
    reviewDecision: null,
    statusCheckRollup: { state: 'SUCCESS' },
    repository: {
      nameWithOwner: 'ignazio-ingenito/example',
      autoMergeAllowed: true,
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
  assert.equal(result[0].json.mergeMethod, 'SQUASH');
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
  const pr = basePr({ statusCheckRollup: { state: 'FAILURE' } });
  assert.equal(eligible(pr).length, 0, 'failed checks must block enrollment');
}

{
  const pr = basePr({ mergeable: 'CONFLICTING' });
  assert.equal(eligible(pr).length, 0, 'conflicting PR must be ignored');
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
    title: 'chore(deps): bump strange-package',
    body: 'Unclassifiable dependency update',
    headRefName: 'dependabot/npm_and_yarn/strange-package',
    author: { login: 'dependabot[bot]' },
  });
  assert.equal(eligible(pr).length, 0, 'unknown update type must fail closed');
}

{
  const pr = basePr({ autoMergeRequest: { enabledAt: '2026-08-12T00:00:00Z' } });
  assert.equal(eligible(pr).length, 0, 'already enrolled PR must be ignored');
}

{
  const pr = basePr({ reviewDecision: 'CHANGES_REQUESTED' });
  assert.equal(eligible(pr).length, 0, 'requested changes must block enrollment');
}

{
  const pr = basePr({
    repository: {
      nameWithOwner: 'other-owner/example',
      autoMergeAllowed: true,
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
    },
  });
  assert.equal(eligible(pr).length, 0, 'PR outside owner scope must be ignored');
}

console.log('OK github dependency automerge policy');
