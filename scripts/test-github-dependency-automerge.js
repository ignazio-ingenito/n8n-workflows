#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, 'workflows', 'github-dependency-automerge.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const policyNode = workflow.nodes.find((node) => node.name === 'Evaluate PR eligibility');
const findNode = workflow.nodes.find((node) => node.name === 'Find open dependency PRs');
const mergeNode = workflow.nodes.find((node) => node.name === 'Merge PR with head SHA');

assert.ok(policyNode);
assert.ok(findNode);
assert.ok(mergeNode);
assert.equal(findNode.credentials.githubApi.id, 'eZohW3VQVXynF9jL');
assert.equal(mergeNode.credentials.githubApi.id, 'eZohW3VQVXynF9jL');
assert.match(mergeNode.parameters.jsonBody, /"sha": "\{\{\$json\.expectedHeadSha\}\}"/);

function evaluate(pullRequests) {
  const script = `(function () {\n${policyNode.parameters.jsCode}\n})()`;
  return vm.runInNewContext(script, {
    $input: { all: () => [{ json: { data: { search: { nodes: pullRequests } } } }] },
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
    author: { login: 'renovate' },
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

assert.equal(evaluate([basePr()]).length, 1);

{
  const result = evaluate([basePr({
    title: 'chore(deps): bump actions/checkout from 7.0.0 to 7.0.1',
    body: 'Dependabot update',
    headRefName: 'dependabot/github_actions/actions/checkout-7.0.1',
    author: { login: 'dependabot' },
  })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].json.updateType, 'patch');
}

assert.equal(evaluate([basePr({ author: { login: 'renovate[bot]' } })]).length, 0);
assert.equal(evaluate([basePr({ author: { login: 'dependabot[bot]' }, headRefName: 'dependabot/x' })]).length, 0);
assert.equal(evaluate([basePr({ isDraft: true })]).length, 0);
assert.equal(evaluate([basePr({ title: 'Configure Renovate', headRefName: 'renovate/configure' })]).length, 0);
assert.equal(evaluate([basePr({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' })]).length, 0);
assert.equal(evaluate([basePr({ mergeStateStatus: 'UNSTABLE' })]).length, 0);
assert.equal(evaluate([basePr({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } })]).length, 0);
assert.equal(evaluate([basePr({ reviewDecision: 'REVIEW_REQUIRED' })]).length, 0);

{
  const result = evaluate([basePr({
    title: 'chore(deps): update dependency undici to v8.0.0 [security]',
    body: '| Package | Update | Change |\n|---|---|---|\n| undici | major | `7.0.0` → `8.0.0` |',
  })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].json.updateType, 'security');
}

assert.equal(evaluate([basePr({
  body: '| Package | Update | Change |\n|---|---|---|\n| example | major | `v1.2.0` → `v2.0.0` |',
})]).length, 0);

console.log('OK github dependency automerge policy');
