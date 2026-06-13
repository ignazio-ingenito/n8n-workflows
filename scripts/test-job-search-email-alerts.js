#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, 'workflows', 'job-search-email-alerts.json');
const fixtureDir = process.argv.includes('--fixture-dir')
  ? path.resolve(process.argv[process.argv.indexOf('--fixture-dir') + 1])
  : path.join(repoRoot, 'scripts', 'fixtures', 'job-alerts-2026-06-12');
const reportOnly = process.argv.includes('--report');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function codeNode(workflow, name) {
  const node = workflow.nodes.find(candidate => candidate.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  if (!node.parameters || !node.parameters.jsCode) {
    throw new Error(`Node ${name} does not contain JavaScript code`);
  }
  return node.parameters.jsCode;
}

function workflowNode(workflow, name) {
  const node = workflow.nodes.find(candidate => candidate.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function hasInvalidTelegramHtmlEntity(value) {
  return /&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/.test(String(value || ''));
}

function observationWindowError(value) {
  if (Number.isInteger(value) && value > 0) return null;
  if (typeof value === 'string' && value.trim() && /\d/.test(value)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'must be a positive cycle count, a non-empty cycle string, or an object with cycle counters';
  }

  const numericKeys = ['cyclesObserved', 'targetCycles', 'remainingCycles', 'currentCycle', 'decisionAfterCycles'];
  const presentNumericKeys = numericKeys.filter(key => Number.isFinite(value[key]));
  if (!presentNumericKeys.length) {
    return 'must contain at least one numeric cycle counter';
  }
  if (presentNumericKeys.some(key => value[key] < 0)) {
    return 'must not contain negative cycle counters';
  }
  if (Number.isFinite(value.targetCycles) && value.targetCycles <= 0) {
    return 'targetCycles must be greater than zero';
  }
  return null;
}

function assertQueryHealthRecommendationShape(item, context, { required = false } = {}) {
  const hasRecommendationFields = ['recommendation', 'recommendationReason', 'observationWindow']
    .some(key => hasOwn(item, key));

  if (!hasRecommendationFields) {
    if (required) {
      throw new Error(`${context} must include recommendation, recommendationReason, and observationWindow`);
    }
    return;
  }

  if (typeof item.recommendation !== 'string' || !item.recommendation.trim()) {
    throw new Error(`${context} must expose a non-empty recommendation string`);
  }
  if (typeof item.recommendationReason !== 'string' || !item.recommendationReason.trim()) {
    throw new Error(`${context} must expose a non-empty recommendationReason string`);
  }
  const observationError = observationWindowError(item.observationWindow);
  if (observationError) {
    throw new Error(`${context} has an invalid observationWindow: ${observationError}`);
  }
}

function assertTelegramNodeUsesHtmlParseMode(workflow) {
  const node = workflowNode(workflow, 'Send Report to Telegram');
  const parseMode = node.parameters?.additionalFields?.parse_mode;
  if (parseMode !== 'HTML') {
    throw new Error(`Send Report to Telegram must explicitly use HTML parse_mode, got "${parseMode}"`);
  }
}

function assertEmailDigestDelivery(workflow) {
  const settings = workflowNode(workflow, 'Delivery Settings');
  const hasDigestEmail = workflowNode(workflow, 'Has Digest Email?');
  const sendEmail = workflowNode(workflow, 'Send Digest Email');
  const settingNames = new Set((settings.parameters?.assignments?.assignments || []).map(assignment => assignment.name));
  if (!settingNames.has('digestEmailTo')) {
    throw new Error('Delivery Settings must expose digestEmailTo for optional email delivery');
  }
  if (!settingNames.has('queryHealth')) {
    throw new Error('Delivery Settings must preserve queryHealth for digest rendering');
  }
  const condition = hasDigestEmail.parameters?.conditions?.conditions?.[0];
  if (condition?.leftValue !== '={{ $json.digestEmailTo }}' || condition?.operator?.operation !== 'notEmpty') {
    throw new Error('Has Digest Email? must route only when digestEmailTo is not empty');
  }
  if (sendEmail.type !== 'n8n-nodes-base.gmail' || sendEmail.parameters?.operation !== 'send') {
    throw new Error('Send Digest Email must use Gmail send operation');
  }
  if (sendEmail.parameters?.sendTo !== '={{ $json.digestEmailTo }}') {
    throw new Error('Send Digest Email must address digestEmailTo from Delivery Settings');
  }
  if (sendEmail.parameters?.emailType !== 'html' || sendEmail.parameters?.message !== '={{ $json.emailHtml }}') {
    throw new Error('Send Digest Email must send the generated HTML digest');
  }
  if (sendEmail.parameters?.options?.appendAttribution !== false) {
    throw new Error('Send Digest Email must disable n8n attribution');
  }
}

function assertProcessedEmailPostProcessing(workflow) {
  const prepareNode = workflowNode(workflow, 'Prepare Processed Emails');
  const ensureLabelNode = workflowNode(workflow, 'Ensure Processed Label');
  const getLabelsNode = workflowNode(workflow, 'Get Processed Labels');
  const resolveLabelNode = workflowNode(workflow, 'Resolve Processed Label Id');
  const expandNode = workflowNode(workflow, 'Expand Processed Emails');
  const addLabelNode = workflowNode(workflow, 'Add Processed Label');
  const markReadNode = workflowNode(workflow, 'Mark Processed Email Read');
  const resultNode = workflowNode(workflow, 'Processed Email Result');

  if (prepareNode.type !== 'n8n-nodes-base.code') throw new Error('Prepare Processed Emails must be a Code node');
  if (ensureLabelNode.type !== 'n8n-nodes-base.gmail' || ensureLabelNode.parameters?.resource !== 'label' || ensureLabelNode.parameters?.operation !== 'create') {
    throw new Error('Ensure Processed Label must be a Gmail label create node');
  }
  if (ensureLabelNode.parameters?.name !== '={{ $json.processedLabelName }}') {
    throw new Error('Ensure Processed Label must create the dynamic processed label name');
  }
  if (ensureLabelNode.continueOnFail !== true) {
    throw new Error('Ensure Processed Label must continue on fail so repeated runs tolerate an existing label');
  }
  if (getLabelsNode.type !== 'n8n-nodes-base.gmail' || getLabelsNode.parameters?.resource !== 'label' || getLabelsNode.parameters?.operation !== 'getAll') {
    throw new Error('Get Processed Labels must use Gmail label getAll');
  }
  if (getLabelsNode.parameters?.returnAll !== true) {
    throw new Error('Get Processed Labels must fetch all labels so the processed label can be resolved by name');
  }
  if (resolveLabelNode.type !== 'n8n-nodes-base.code') throw new Error('Resolve Processed Label Id must be a Code node');
  if (expandNode.type !== 'n8n-nodes-base.code') throw new Error('Expand Processed Emails must be a Code node');
  if (addLabelNode.type !== 'n8n-nodes-base.gmail' || addLabelNode.parameters?.resource !== 'message' || addLabelNode.parameters?.operation !== 'addLabels') {
    throw new Error('Add Processed Label must use Gmail message addLabels');
  }
  if (addLabelNode.parameters?.labelIds !== '={{ [$json.processedLabelId].filter(Boolean) }}') {
    throw new Error('Add Processed Label must apply the resolved Gmail label id');
  }
  if (markReadNode.type !== 'n8n-nodes-base.gmail' || markReadNode.parameters?.resource !== 'message' || markReadNode.parameters?.operation !== 'markAsRead') {
    throw new Error('Mark Processed Email Read must use Gmail message markAsRead');
  }
  if (resultNode.type !== 'n8n-nodes-base.code') throw new Error('Processed Email Result must be a Code node');

  const emailTargets = workflow.connections?.['Email Delivery Result']?.main?.[0]?.map(edge => edge.node) || [];
  const telegramTargets = workflow.connections?.['Telegram Delivery Result']?.main?.[0]?.map(edge => edge.node) || [];
  const prepareTargets = workflow.connections?.['Prepare Processed Emails']?.main?.[0]?.map(edge => edge.node) || [];
  const ensureTargets = workflow.connections?.['Ensure Processed Label']?.main?.[0]?.map(edge => edge.node) || [];
  const getLabelsTargets = workflow.connections?.['Get Processed Labels']?.main?.[0]?.map(edge => edge.node) || [];
  const resolveTargets = workflow.connections?.['Resolve Processed Label Id']?.main?.[0]?.map(edge => edge.node) || [];
  const expandTargets = workflow.connections?.['Expand Processed Emails']?.main?.[0]?.map(edge => edge.node) || [];
  const addLabelTargets = workflow.connections?.['Add Processed Label']?.main?.[0]?.map(edge => edge.node) || [];
  const markReadTargets = workflow.connections?.['Mark Processed Email Read']?.main?.[0]?.map(edge => edge.node) || [];

  if (!emailTargets.includes('Prepare Processed Emails')) throw new Error('Email Delivery Result must trigger Prepare Processed Emails');
  if (!telegramTargets.includes('Prepare Processed Emails')) throw new Error('Telegram Delivery Result must trigger Prepare Processed Emails');
  if (!prepareTargets.includes('Ensure Processed Label')) throw new Error('Prepare Processed Emails must feed Ensure Processed Label');
  if (!ensureTargets.includes('Get Processed Labels')) throw new Error('Ensure Processed Label must feed Get Processed Labels');
  if (!getLabelsTargets.includes('Resolve Processed Label Id')) throw new Error('Get Processed Labels must feed Resolve Processed Label Id');
  if (!resolveTargets.includes('Expand Processed Emails')) throw new Error('Resolve Processed Label Id must feed Expand Processed Emails');
  if (!expandTargets.includes('Add Processed Label')) throw new Error('Expand Processed Emails must feed Add Processed Label');
  if (!addLabelTargets.includes('Mark Processed Email Read')) throw new Error('Add Processed Label must feed Mark Processed Email Read');
  if (!markReadTargets.includes('Processed Email Result')) throw new Error('Mark Processed Email Read must feed Processed Email Result');
}

async function runPrepareProcessedEmailsUnitChecks(workflow) {
  const code = codeNode(workflow, 'Prepare Processed Emails');
  const result = await runCode(code, [{ json: {
    deliveryStatus: 'sent_email',
    records: [
      { emailId: 'abc#1' },
      { emailId: 'abc#2' },
      { emailId: 'def#1' },
      { emailId: '' }
    ]
  } }]);

  if (result.processedLabelName !== 'job-alert/processed') throw new Error('Prepare Processed Emails must set the processed label name');
  if (JSON.stringify(result.processedMessageIds) !== JSON.stringify(['abc', 'def'])) {
    throw new Error('Prepare Processed Emails must deduplicate Gmail message IDs from record emailId values');
  }
  if (result.processedMessageCount !== 2) throw new Error('Prepare Processed Emails must expose the processed message count');
}

async function runResolveProcessedLabelIdUnitChecks(workflow) {
  const code = codeNode(workflow, 'Resolve Processed Label Id');
  const result = await runCode(code, [
    { json: { id: 'Label_1', name: 'job-alert/processed' } },
    { json: { id: 'Label_2', name: 'Other' } },
  ], {
    'Prepare Processed Emails': [{
      json: {
        processedLabelName: 'job-alert/processed',
        processedMessageIds: ['abc'],
      }
    }],
  });

  if (result.processedLabelId !== 'Label_1') {
    throw new Error('Resolve Processed Label Id must find the Gmail label id by label name');
  }
  if (result.processedLabelLookupError) {
    throw new Error('Resolve Processed Label Id must not emit a lookup error when the label exists');
  }
}

function assertGmailBacklogScan(workflow) {
  const schedule = workflowNode(workflow, 'Schedule Trigger');
  if (schedule.type !== 'n8n-nodes-base.scheduleTrigger') {
    throw new Error('Job Search Email Alerts must start from Schedule Trigger for unread backlog scans');
  }
  const scan = workflowNode(workflow, 'Scan Job Alert Emails');
  if (scan.type !== 'n8n-nodes-base.gmail' || scan.parameters?.operation !== 'getAll') {
    throw new Error('Scan Job Alert Emails must use Gmail Get Many instead of Gmail Trigger');
  }
  if (scan.parameters?.filters?.readStatus !== 'unread') {
    throw new Error('Scan Job Alert Emails must scan unread messages');
  }
  const scanTargets = workflow.connections?.['Scan Job Alert Emails']?.main?.[0]?.map(edge => edge.node) || [];
  if (!scanTargets.includes('Parse and Score Alerts')) {
    throw new Error('Scan Job Alert Emails must feed Parse and Score Alerts directly');
  }
}

function validateWorkflowGraph(workflow) {
  const enrichmentIf = workflowNode(workflow, 'Has Enrichment Requests?');
  const condition = enrichmentIf.parameters?.conditions?.conditions?.[0];
  const operation = condition?.operator?.operation;
  if (operation !== 'gt') {
    throw new Error(`Has Enrichment Requests? must use n8n number operation "gt", got "${operation}"`);
  }
  const historyNode = workflowNode(workflow, 'Update Query History');
  if (historyNode.type !== 'n8n-nodes-base.code') {
    throw new Error('Update Query History must be a Code node');
  }
  const falseTargets = workflow.connections?.['Has Enrichment Requests?']?.main?.[1]?.map(edge => edge.node) || [];
  if (!falseTargets.includes('Update Query History')) {
    throw new Error('Has Enrichment Requests? false path must go through Update Query History before delivery');
  }
  const mergeTargets = workflow.connections?.['Merge Enriched Alert Report']?.main?.[0]?.map(edge => edge.node) || [];
  if (!mergeTargets.includes('Update Query History')) {
    throw new Error('Merge Enriched Alert Report must feed Update Query History before delivery');
  }
  const historyTargets = workflow.connections?.['Update Query History']?.main?.[0]?.map(edge => edge.node) || [];
  if (!historyTargets.includes('Delivery Settings')) {
    throw new Error('Update Query History must feed Delivery Settings');
  }
  assertTelegramNodeUsesHtmlParseMode(workflow);
  assertEmailDigestDelivery(workflow);
  assertGmailBacklogScan(workflow);
  assertProcessedEmailPostProcessing(workflow);
}

function fixtureFiles(dir) {
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.sanitized.json'))
    .sort()
    .map(file => path.join(dir, file));
}

async function runCodeItems(code, inputItems, referencedNodeItems = {}, runtime = {}) {
  const workflowStaticData = runtime.workflowStaticData || {};
  const output = await vm.runInNewContext(`(async function(){${code}
})()`, {
    $input: {
      all: () => inputItems,
      first: () => inputItems[0]
    },
    $: name => ({
      all: () => referencedNodeItems[name] || [],
      first: () => (referencedNodeItems[name] || [])[0]
    }),
    $items: name => referencedNodeItems[name] || [],
    $node: Object.fromEntries(Object.entries(referencedNodeItems).map(([name, items]) => [
      name,
      { json: items[0]?.json || {} }
    ])),
    $getWorkflowStaticData: () => workflowStaticData,
    getWorkflowStaticData: () => workflowStaticData,
    console
  }, { timeout: 5000 });

  if (!Array.isArray(output) || output.some(item => !item || !item.json)) {
    throw new Error('Code node returned an invalid n8n item array');
  }
  return output;
}

async function runCode(code, inputItems, referencedNodeItems = {}, runtime = {}) {
  const output = await runCodeItems(code, inputItems, referencedNodeItems, runtime);
  if (!output[0]) throw new Error('Code node returned no items');
  return output[0].json;
}

async function runParseNode(code, fixture) {
  const email = {
    id: fixture.id,
    subject: fixture.subject,
    from: fixture.from,
    date: fixture.date,
    textPlain: fixture.textPlain,
    text: fixture.text,
    textHtml: fixture.textHtml || '',
    html: fixture.html || '',
    enrichmentHtmlByUrl: fixture.enrichmentHtmlByUrl || {},
    snippet: ''
  };

  return runCode(code, [{ json: email }]);
}

async function runTelegramNode(code, report) {
  return runCode(code, [{ json: report }]);
}

async function runEmailDigestNode(code, report) {
  return runCode(code, [{ json: report }]);
}

async function runQueryHistoryNode(code, report, workflowStaticData) {
  return runCode(code, [{ json: report }], {}, { workflowStaticData });
}

async function runParseNodeUnitChecks(workflow) {
  const parseCode = codeNode(workflow, 'Parse and Score Alerts');
  const fixture = {
    id: 'unit-platform-mismatch',
    subject: 'Platform Engineering Lead',
    from: 'jobalerts-noreply@linkedin.com',
    date: '2026-06-12T00:00:00.000Z',
    textPlain: [
      'Il tuo avviso di offerte di lavoro e stato creato: Platform Engineering Lead (Italia).',
      'Riceverai notifiche quando vengono pubblicate nuove offerte di lavoro che corrispondono alle tue preferenze di ricerca.',
      '',
      'Director of Engineering',
      'Jobgether',
      'Italia',
      '',
      'Candidati con curriculum e profilo',
      'Visualizza offerta di lavoro: https://www.linkedin.com/comm/jobs/view/4424508735'
    ].join('\n'),
    text: '',
    textHtml: '',
    html: ''
  };
  const report = await runParseNode(parseCode, fixture);
  const record = report.records?.find(item => item.url === 'https://www.linkedin.com/comm/jobs/view/4424508735');
  if (!record) {
    throw new Error('Parse and Score Alerts must extract the platform-mismatch unit record');
  }
  if (record.queryAlignmentStatus !== 'mismatch') {
    throw new Error(`Expected platform-mismatch record to have queryAlignmentStatus=mismatch, got "${record.queryAlignmentStatus}"`);
  }
  if (record.recommendedAction === 'inspect manually') {
    throw new Error('Parse and Score Alerts must not keep generic engineering leadership roles as manual inspection for platform alerts');
  }
  if (record.dataPoor !== false) {
    throw new Error('Parse and Score Alerts must disable the dataPoor manual-review override for query mismatches');
  }
}

async function runQueryHistoryNodeUnitChecks(workflow) {
  const historyCode = codeNode(workflow, 'Update Query History');
  const workflowStaticData = {};
  let report;
  for (let index = 0; index < 5; index += 1) {
    report = await runQueryHistoryNode(historyCode, {
      generatedAt: '2026-06-1' + index + 'T00:00:00.000Z',
      queryHealth: [{
        query: 'Engineering Leadership',
        narrative: 'Technical Leadership for Delivery, Scale and Execution',
        aliases: ['Head Of Engineering'],
        jobs: 4,
        apply: 0,
        highInterest: 1,
        manualInspection: 1,
        ignored: 2,
        belowThreshold: 0,
        signalCount: 2,
        primaryNarrativeFitRate: 0.75,
        manualInspectionRate: 0.5,
        outOfNarrativeNoiseRate: 0.25,
        outOfScopeRate: 0,
        recommendation: 'keep',
        recommendationReason: 'consistent narrative fit with at least one relevant signal',
        status: 'strong'
      }]
    }, workflowStaticData);
  }
  const item = report.queryHealth?.[0];
  if (!item || item.observedCycles !== 5 || item.historyWindowUsed !== 5) {
    throw new Error('Update Query History must keep a rolling five-cycle window per query');
  }
  if (item.recommendation !== 'keep') {
    throw new Error('Update Query History must promote a consistently good query to keep after five cycles');
  }
  if (item.currentCycleRecommendation !== 'keep' || !/five-cycle history/.test(item.recommendationReason || '')) {
    throw new Error('Update Query History must preserve current-cycle recommendation and replace delivery recommendation with the historical decision');
  }
  if (!workflowStaticData.jobSearchAlertQueryHistory?.['Engineering Leadership'] || workflowStaticData.jobSearchAlertQueryHistory['Engineering Leadership'].length !== 5) {
    throw new Error('Update Query History must persist rolling history in workflow static data');
  }
}

async function runMergeNodeUnitChecks(workflow) {
  const mergeCode = codeNode(workflow, 'Merge Enriched Alert Report');
  const baseRecord = {
    title: 'Director of Engineering',
    company: 'Jobgether',
    url: 'https://www.linkedin.com/comm/jobs/view/4424508735',
    emailId: 'unit#1',
    source: 'LinkedIn alert email',
    alertQuery: 'Platform Engineering Lead',
    dataPoor: true,
    enrichmentStatus: 'not_attempted',
    recommendedAction: 'inspect manually',
    applicationPriorityScore: 45,
    profileFitScore: 22,
    marketDemandScore: 40,
    candidateAdvantageScore: 0,
    roleFamily: 'Engineering Leadership',
    seniority: 'executive/leadership',
    companySizeAssumption: 'unknown',
    explanation: 'unit record'
  };
  const baseReport = {
    generatedAt: '2026-06-12T00:00:00.000Z',
    emailCount: 1,
    parsedCount: 1,
    matchCount: 1,
    minPriorityScore: 35,
    familySummary: {},
    records: [baseRecord],
    matches: [baseRecord],
    markdown: ''
  };
  const preparedItems = [{
    json: {
      report: baseReport,
      emailId: 'unit#1',
      url: baseRecord.url,
      title: baseRecord.title,
      company: baseRecord.company
    }
  }];
  const loginWallHtml = '<html><head><title>LinkedIn Login, Sign in | LinkedIn</title><meta name="pageKey" content="d_checkpoint_lg_consumer_login"></head><body><form class="login__form" action="/checkpoint/lg/login-submit"><input name="session_redirect" value="/jobs/view/4424508735"></form></body></html>';
  const report = await runCode(mergeCode, [{ json: { jobDetailHtml: loginWallHtml } }], {
    'Prepare Enrichment Requests': preparedItems
  });
  const record = report.records?.[0];
  if (report.parsedCount !== 1 || report.records?.length !== 1) {
    throw new Error('Merge Enriched Alert Report must preserve the base report when HTTP output omits input data');
  }
  if (record?.enrichmentStatus !== 'login_wall') {
    throw new Error(`Expected LinkedIn login page to become enrichmentStatus=login_wall, got "${record?.enrichmentStatus}"`);
  }
  if (!Array.isArray(report.queryHealth) || report.queryHealth[0]?.query !== 'Platform / Cloud / DevOps') {
    throw new Error('Merge Enriched Alert Report must recompute canonical queryHealth from merged records');
  }
  if (!report.queryHealth[0]?.aliases?.includes('Platform Engineering Lead')) {
    throw new Error('Merge Enriched Alert Report must preserve original alert query aliases inside queryHealth');
  }
  assertQueryHealthRecommendationShape(report.queryHealth[0], 'Merge Enriched Alert Report queryHealth[0]');
}

async function runEmailDigestNodeUnitChecks(workflow) {
  const emailCode = codeNode(workflow, 'Build Email Digest');
  const report = {
    generatedAt: '2026-06-12T00:00:00.000Z',
    emailCount: 2,
    parsedCount: 2,
    matches: [{
      title: 'Head of Platform',
      company: 'Example Corp',
      url: 'https://www.linkedin.com/comm/jobs/view/1',
      source: 'LinkedIn alert email',
      alertQuery: 'Platform Engineering Lead',
      recommendedAction: 'inspect manually',
      applicationPriorityScore: 69,
      profileFitScore: 60,
      primaryNarrative: 'Platform Modernization & Reliability',
      secondaryNarrative: 'Technical Leadership for Delivery, Scale and Execution',
      enrichmentStatus: 'login_wall'
    }],
    queryHealth: [
      {
        query: 'Platform / Cloud / DevOps',
        narrative: 'Platform Modernization & Reliability',
        aliases: ['Platform Engineering Lead', 'Head of Platform'],
        alertEmailCount: 2,
        jobs: 1,
        apply: 0,
        highInterest: 1,
        manualInspection: 0,
        ignored: 0,
        belowThreshold: 0,
        maxPriority: 69,
        avgPriority: 69,
        signalCount: 1,
        primaryNarrativeFitRate: 1,
        manualInspectionRate: 1,
        outOfNarrativeNoiseRate: 0,
        outOfScopeRate: 0,
        status: 'strong',
        recommendation: 'keep',
        recommendationReason: 'High narrative fit with clean signal quality across the observed jobs.',
        currentCycleRecommendation: 'inspect manually',
        currentCycleRecommendationReason: 'Current cycle still needs operator review before the history window closes.',
        observationWindow: { cyclesObserved: 2, targetCycles: 5 }
      },
      {
        query: 'Engineering Management',
        narrative: 'Technical Leadership for Delivery, Scale and Execution',
        aliases: ['Engineering Manager'],
        jobs: 2,
        apply: 0,
        highInterest: 0,
        manualInspection: 0,
        ignored: 2,
        belowThreshold: 0,
        maxPriority: 24,
        avgPriority: 24,
        signalCount: 0,
        primaryNarrativeFitRate: 0.5,
        manualInspectionRate: 0,
        outOfNarrativeNoiseRate: 0.5,
        outOfScopeRate: 0,
        status: 'no_signal',
        recommendation: 'observe',
        recommendationReason: 'Wait for more cycles before narrowing or retiring this query.',
        currentCycleRecommendation: 'ignore',
        currentCycleRecommendationReason: 'Current cycle produced no narrative signal.',
        observationWindow: { cyclesObserved: 2, targetCycles: 5 }
      }
    ],
    records: [
      {
        title: 'Engineering Manager',
        company: 'Subito',
        url: 'https://www.linkedin.com/comm/jobs/view/4421934755',
        source: 'LinkedIn alert email',
        alertQuery: 'Engineering Manager',
        recommendedAction: 'ignore',
        applicationPriorityScore: 24,
        profileFitScore: 30
      },
      {
        title: 'Engineering Manager',
        company: 'Subito',
        url: 'https://www.linkedin.com/comm/jobs/view/4421934755',
        source: 'LinkedIn alert email',
        alertQuery: 'Engineering Manager',
        recommendedAction: 'ignore',
        applicationPriorityScore: 24,
        profileFitScore: 30
      }
    ]
  };
  report.queryHealth.forEach((item, index) => {
    assertQueryHealthRecommendationShape(item, `Build Email Digest unit queryHealth[${index}]`, { required: true });
  });
  const result = await runEmailDigestNode(emailCode, report);
  if (!/Job Search Email Alerts - 2026-06-12 00:00 UTC - 1 da valutare/.test(result.emailSubject || '')) {
    throw new Error('Build Email Digest must generate a useful subject with the review count');
  }
  if (!/Email messages: 2/.test(result.emailText || '') || !/Jobs parsed: 2/.test(result.emailText || '')) {
    throw new Error('Build Email Digest must include email and job counts in the plain text body');
  }
  if (!/Platform Modernization &amp; Reliability/.test(result.emailHtml || '') || !/1\. Head of Platform/.test(result.emailHtml || '')) {
    throw new Error('Build Email Digest must HTML-escape job titles and render explicit item numbers in the HTML body');
  }
  if (!/fonts\.googleapis\.com\/css2\?family=Montserrat/.test(result.emailHtml || '') || !/font-family:Montserrat,Arial,sans-serif/.test(result.emailHtml || '')) {
    throw new Error('Build Email Digest must request Google Montserrat and use it as the primary email font');
  }
  if (!/Alert decisions/.test(result.emailText || '') || !/Platform \/ Cloud \/ DevOps - keep/.test(result.emailText || '') || !/Current cycle: inspect manually/.test(result.emailText || '') || !/Observed: 0\/5 cycles/.test(result.emailText || '')) {
    throw new Error('Build Email Digest must surface stable alert decisions ahead of detailed query health');
  }
  if (!/Recommendation: keep \| Current: inspect manually \| Window: 5 cycles/.test(result.emailText || '') || !(result.emailHtml || '').includes('Current:</span> inspect manually')) {
    throw new Error('Build Email Digest must expose both historical and current-cycle recommendations in query health');
  }
  if (!/Query Health/.test(result.emailText || '') || !/Alert: Platform Engineering Lead/.test(result.emailText || '') || !/Platform \/ Cloud \/ DevOps - strong/.test(result.emailHtml || '')) {
    throw new Error('Build Email Digest must include alert query health and per-job alert query context');
  }
  if (!/High interest \(1\)/.test(result.emailHtml || '') || !/Technical Leadership for Delivery, Scale and Execution/.test(result.emailHtml || '') || /<ol>|<li>/.test(result.emailHtml || '')) {
    throw new Error('Build Email Digest must render email-safe HTML sections without relying on ordered-list markers');
  }
  if (/Recommendation|Raccomandazione/i.test((result.emailHtml || '') + '\n' + (result.emailText || ''))) {
    if (!/keep|observe/i.test((result.emailHtml || '') + '\n' + (result.emailText || '')) || !/5/.test((result.emailHtml || '') + '\n' + (result.emailText || ''))) {
      throw new Error('Build Email Digest must render useful recommendation details when queryHealth recommendations are included');
    }
  }
  const engineeringManagerOccurrences = (result.emailText.match(/Engineering Manager - Subito/g) || []).length;
  if (engineeringManagerOccurrences !== 1) {
    throw new Error('Build Email Digest must deduplicate Below threshold records by URL or title');
  }
}

async function runTelegramNodeUnitChecks(workflow) {
  const telegramCode = codeNode(workflow, 'Build Telegram Message');
  const report = {
    generatedAt: '2026-06-12T00:00:00.000Z',
    emailCount: 1,
    parsedCount: 1,
    matches: [{
      title: 'Head of Platform',
      company: 'Example Corp',
      url: 'https://www.linkedin.com/comm/jobs/view/1',
      source: 'LinkedIn alert email',
      alertQuery: 'Platform Engineering Lead',
      recommendedAction: 'inspect manually',
      applicationPriorityScore: 69,
      profileFitScore: 60,
      primaryNarrative: 'Platform Modernization & Reliability',
      secondaryNarrative: 'Technical Leadership for Delivery, Scale and Execution',
      enrichmentStatus: 'fetched'
    }],
    queryHealth: [
      {
        query: 'Platform / Cloud / DevOps',
        narrative: 'Platform Modernization & Reliability',
        aliases: ['Platform Engineering Lead', 'Head of Platform'],
        alertEmailCount: 2,
        jobs: 1,
        apply: 0,
        highInterest: 1,
        manualInspection: 0,
        ignored: 0,
        belowThreshold: 0,
        maxPriority: 69,
        avgPriority: 69,
        signalCount: 1,
        primaryNarrativeFitRate: 1,
        manualInspectionRate: 1,
        outOfNarrativeNoiseRate: 0,
        outOfScopeRate: 0,
        status: 'strong',
        recommendation: 'keep',
        recommendationReason: 'High narrative fit with clean signal quality across the observed jobs.',
        currentCycleRecommendation: 'inspect manually',
        currentCycleRecommendationReason: 'Current cycle still needs operator review before the history window closes.',
        observationWindow: { cyclesObserved: 2, targetCycles: 5 }
      },
      {
        query: 'Engineering Management',
        narrative: 'Technical Leadership for Delivery, Scale and Execution',
        aliases: ['Engineering Manager'],
        jobs: 2,
        apply: 0,
        highInterest: 0,
        manualInspection: 0,
        ignored: 2,
        belowThreshold: 0,
        maxPriority: 24,
        avgPriority: 24,
        signalCount: 0,
        primaryNarrativeFitRate: 0.5,
        manualInspectionRate: 0,
        outOfNarrativeNoiseRate: 0.5,
        outOfScopeRate: 0,
        status: 'no_signal',
        recommendation: 'observe',
        recommendationReason: 'Wait for more cycles before narrowing or retiring this query.',
        currentCycleRecommendation: 'ignore',
        currentCycleRecommendationReason: 'Current cycle produced no narrative signal.',
        observationWindow: { cyclesObserved: 2, targetCycles: 5 }
      }
    ],
    records: [
      {
        title: 'Engineering Manager',
        company: 'Subito',
        url: 'https://www.linkedin.com/comm/jobs/view/4421934755',
        source: 'LinkedIn alert email',
        alertQuery: 'Engineering Manager',
        recommendedAction: 'ignore',
        applicationPriorityScore: 24,
        profileFitScore: 30
      },
      {
        title: 'Engineering Manager',
        company: 'Subito',
        url: 'https://www.linkedin.com/comm/jobs/view/4421934755',
        source: 'LinkedIn alert email',
        alertQuery: 'Engineering Manager',
        recommendedAction: 'ignore',
        applicationPriorityScore: 24,
        profileFitScore: 30
      }
    ]
  };
  report.queryHealth.forEach((item, index) => {
    assertQueryHealthRecommendationShape(item, `Build Telegram Message unit queryHealth[${index}]`, { required: true });
  });
  const result = await runTelegramNode(telegramCode, report);
  if (!/Email messages: 1/.test(result.telegramMessage || '') || !/Jobs parsed: 1/.test(result.telegramMessage || '')) {
    throw new Error('Build Telegram Message must show separate email and parsed job counts');
  }
  if (!/High interest: 1/.test(result.telegramMessage || '') || !/High interest\nPlatform Modernization &amp; Reliability \+ Technical Leadership for Delivery, Scale and Execution\n1\. Head of Platform/.test(result.telegramMessage || '')) {
    throw new Error('Build Telegram Message must show high-priority inspect records in the High interest section and HTML-escape Telegram text');
  }
  if (!(result.telegramMessage || '').includes('Alert decisions') || !(result.telegramMessage || '').includes('Platform / Cloud / DevOps - keep') || !(result.telegramMessage || '').includes('Current cycle: inspect manually') || !(result.telegramMessage || '').includes('Observed: 0/5 cycles')) {
    throw new Error('Build Telegram Message must surface stable alert decisions ahead of detailed query health');
  }
  if (!(result.telegramMessage || '').toLowerCase().includes('recommendation keep | current inspect manually | window 5 cycles')) {
    throw new Error('Build Telegram Message must expose both historical and current-cycle recommendations in query health');
  }
  if (!/Query Health/.test(result.telegramMessage || '') || !/Platform \/ Cloud \/ DevOps - strong/.test(result.telegramMessage || '') || !/Alert: Platform Engineering Lead/.test(result.telegramMessage || '')) {
    throw new Error('Build Telegram Message must include alert query health and per-job alert query context');
  }
  if (hasInvalidTelegramHtmlEntity(result.telegramMessage)) {
    throw new Error('Build Telegram Message must not emit invalid HTML entities because the Telegram node defaults to HTML parse mode');
  }
  if (/Recommendation|Raccomandazione/i.test(result.telegramMessage || '')) {
    if (!/keep|observe/i.test(result.telegramMessage || '') || !/5/.test(result.telegramMessage || '')) {
      throw new Error('Build Telegram Message must render useful recommendation details when queryHealth recommendations are included');
    }
  }
  if (/Manual inspection: 1/.test(result.telegramMessage || '')) {
    throw new Error('High interest records must not also be counted as manual inspection');
  }
  const engineeringManagerOccurrences = (result.telegramMessage.match(/Engineering Manager - Subito/g) || []).length;
  if (engineeringManagerOccurrences !== 1) {
    throw new Error('Build Telegram Message must deduplicate Below threshold records by URL or title');
  }
}

async function runEnrichmentGraph(workflow, report, fixture) {
  const requests = Array.isArray(report.enrichmentRequests) ? report.enrichmentRequests : [];
  if (!requests.length) return report;

  const prepareCode = codeNode(workflow, 'Prepare Enrichment Requests');
  const mergeCode = codeNode(workflow, 'Merge Enriched Alert Report');
  const requestItems = await runCodeItems(prepareCode, [{ json: report }]);
  const htmlByUrl = fixture.enrichmentHtmlByUrl || {};
  const fetchedItems = requestItems.map(item => {
    const url = item.json.url || '';
    if (!Object.prototype.hasOwnProperty.call(htmlByUrl, url)) {
      return {
        json: {
          error: { message: 'No mocked enrichment response for ' + url }
        }
      };
    }
    return {
      json: {
        jobDetailHtml: htmlByUrl[url]
      }
    };
  });

  return runCode(mergeCode, fetchedItems, {
    'Prepare Enrichment Requests': requestItems
  });
}

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isStrongDataPoorTitle(title) {
  return /\b(chief technology officer|field cto|engineering manager|director of engineering)\b/i.test(title);
}

function evaluate(filePath, report, telegramReport) {
  const fixture = readJson(filePath);
  const expectedJobs = fixture.expected?.jobs || [];
  const expectedTitles = expectedJobs.map(job => job.title);
  const actualRecords = report.records || [];
  const actualTitles = actualRecords.map(record => record.title || '');
  const actualTitleSet = new Set(actualTitles.map(normalizeTitle));
  const expectedTitleSet = new Set(expectedTitles.map(normalizeTitle));

  const missingTitles = expectedTitles.filter(title => !actualTitleSet.has(normalizeTitle(title)));
  const unexpectedTitles = actualTitles.filter(title => !expectedTitleSet.has(normalizeTitle(title)));
  const missingCanonicalUrls = expectedJobs
    .filter(job => job.url && !actualRecords.some(record => record.url === job.url))
    .map(job => job.url);
  const preheaderLeak = actualTitles.filter(title => /avviso di offerte|riceverai notifiche|vedi tutte le offerte/i.test(title));
  const expectedAlertQuery = String(fixture.expected?.alertQuery || fixture.query || '').replace(/ live Gmail shape$/i, '').trim();
  const missingAlertQuery = expectedAlertQuery
    ? actualRecords
      .filter(record => String(record.alertQuery || '').trim().toLowerCase() !== expectedAlertQuery.toLowerCase())
      .map(record => record.title || 'n/a')
    : actualRecords.filter(record => !record.alertQuery).map(record => record.title || 'n/a');
  const queryHealthFailures = expectedAlertQuery && !(report.queryHealth || []).some(item => String(item.query || '').trim().toLowerCase() === expectedAlertQuery.toLowerCase() || (Array.isArray(item.aliases) && item.aliases.some(alias => String(alias || '').trim().toLowerCase() === expectedAlertQuery.toLowerCase())))
    ? ['missing queryHealth for ' + expectedAlertQuery]
    : [];
  for (const item of report.queryHealth || []) {
    try {
      assertQueryHealthRecommendationShape(item, `queryHealth ${item.query || 'unknown'}`);
    } catch (error) {
      queryHealthFailures.push(error.message);
    }
  }
  const strongDataPoorFailures = expectedTitles
    .filter(isStrongDataPoorTitle)
    .filter(title => {
      const record = actualRecords.find(candidate => normalizeTitle(candidate.title) === normalizeTitle(title));
      if (!record) return true;
      if (record.enrichmentStatus === 'fetched') {
        return !['inspect manually', 'apply'].includes(record.recommendedAction);
      }
      if (record.queryAlignmentStatus === 'mismatch') {
        return false;
      }
      return record.dataPoor !== true || record.recommendedAction !== 'inspect manually';
    });
  const expectedEnrichedUrls = fixture.expected?.enrichedUrls || [];
  const missingEnrichedUrls = expectedEnrichedUrls.filter(url => {
    const record = actualRecords.find(candidate => candidate.url === url);
    return !record || record.enrichmentStatus !== 'fetched' || !record.enrichmentSource;
  });
  const telegramMessage = telegramReport.telegramMessage || '';
  const telegramSectionFailures = [];
  if ((report.matches || []).some(job => job.recommendedAction === 'inspect manually')) {
    if (!/Needs manual inspection/i.test(telegramMessage)) telegramSectionFailures.push('missing manual inspection section');
    if (/Best parsed jobs below threshold/i.test(telegramMessage)) telegramSectionFailures.push('legacy below-threshold title shown with inspect records');
  }
  if (!/Below threshold/i.test(telegramMessage)) telegramSectionFailures.push('missing below threshold section');
  if (hasInvalidTelegramHtmlEntity(telegramMessage)) telegramSectionFailures.push('invalid Telegram HTML entity');

  return {
    file: path.basename(filePath),
    query: fixture.query,
    expectedCount: expectedJobs.length,
    emailCount: report.emailCount,
    parsedCount: report.parsedCount,
    matchCount: report.matchCount,
    missingTitles,
    unexpectedTitles,
    missingCanonicalUrls,
    missingEnrichedUrls,
    preheaderLeak,
    missingAlertQuery,
    queryHealthFailures,
    strongDataPoorFailures,
    telegramSectionFailures,
    telegramPreview: telegramMessage.slice(0, 700),
    actualTitles,
    actions: actualRecords.map(record => ({
      title: record.title,
      action: record.recommendedAction,
      priority: record.applicationPriorityScore,
      roleFamily: record.roleFamily,
      url: record.url || '',
      enrichmentStatus: record.enrichmentStatus || '',
      alertQuery: record.alertQuery || ''
    }))
  };
}

async function main() {
  const workflow = readJson(workflowPath);
  validateWorkflowGraph(workflow);
  await runParseNodeUnitChecks(workflow);
  await runMergeNodeUnitChecks(workflow);
  await runPrepareProcessedEmailsUnitChecks(workflow);
  await runResolveProcessedLabelIdUnitChecks(workflow);
  await runQueryHistoryNodeUnitChecks(workflow);
  await runEmailDigestNodeUnitChecks(workflow);
  await runTelegramNodeUnitChecks(workflow);
  const parseCode = codeNode(workflow, 'Parse and Score Alerts');
  const telegramCode = codeNode(workflow, 'Build Telegram Message');
  const files = fixtureFiles(fixtureDir);
  if (!files.length) throw new Error(`No sanitized fixtures found in ${fixtureDir}`);

  const results = [];
  for (const file of files) {
    const fixture = readJson(file);
    const parsedReport = await runParseNode(parseCode, fixture);
    const report = await runEnrichmentGraph(workflow, parsedReport, fixture);
    const telegramReport = await runTelegramNode(telegramCode, report);
    results.push(evaluate(file, report, telegramReport));
  }
  const failures = results.filter(result =>
    result.parsedCount !== result.expectedCount
    || result.missingTitles.length
    || result.missingCanonicalUrls.length
    || result.missingEnrichedUrls.length
    || result.preheaderLeak.length
    || result.missingAlertQuery.length
    || result.queryHealthFailures.length
    || result.strongDataPoorFailures.length
    || result.telegramSectionFailures.length
  );

  const summary = {
    fixtureDir,
    fixtureCount: results.length,
    expectedJobs: results.reduce((sum, result) => sum + result.expectedCount, 0),
    emailMessages: results.reduce((sum, result) => sum + (result.emailCount || 0), 0),
    parsedJobs: results.reduce((sum, result) => sum + result.parsedCount, 0),
    failures: failures.length,
    results
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length && !reportOnly) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
