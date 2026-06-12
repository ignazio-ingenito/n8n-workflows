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

function validateWorkflowGraph(workflow) {
  const enrichmentIf = workflowNode(workflow, 'Has Enrichment Requests?');
  const condition = enrichmentIf.parameters?.conditions?.conditions?.[0];
  const operation = condition?.operator?.operation;
  if (operation !== 'gt') {
    throw new Error(`Has Enrichment Requests? must use n8n number operation "gt", got "${operation}"`);
  }
}

function fixtureFiles(dir) {
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.sanitized.json'))
    .sort()
    .map(file => path.join(dir, file));
}

async function runCodeItems(code, inputItems, referencedNodeItems = {}) {
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
    console
  }, { timeout: 5000 });

  if (!Array.isArray(output) || output.some(item => !item || !item.json)) {
    throw new Error('Code node returned an invalid n8n item array');
  }
  return output;
}

async function runCode(code, inputItems, referencedNodeItems = {}) {
  const output = await runCodeItems(code, inputItems, referencedNodeItems);
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

async function runMergeNodeUnitChecks(workflow) {
  const mergeCode = codeNode(workflow, 'Merge Enriched Alert Report');
  const baseRecord = {
    title: 'Director of Engineering',
    company: 'Jobgether',
    url: 'https://www.linkedin.com/comm/jobs/view/4424508735',
    emailId: 'unit#1',
    source: 'LinkedIn alert email',
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
}

async function runTelegramNodeUnitChecks(workflow) {
  const telegramCode = codeNode(workflow, 'Build Telegram Message');
  const report = {
    generatedAt: '2026-06-12T00:00:00.000Z',
    parsedCount: 1,
    matches: [{
      title: 'Chief Technology Officer',
      company: 'WeHunt',
      url: 'https://www.linkedin.com/comm/jobs/view/1',
      source: 'LinkedIn alert email',
      recommendedAction: 'inspect manually',
      applicationPriorityScore: 69,
      profileFitScore: 60,
      enrichmentStatus: 'fetched'
    }],
    records: []
  };
  const result = await runTelegramNode(telegramCode, report);
  if (!/High interest: 1/.test(result.telegramMessage || '') || !/High interest\n1\. Chief Technology Officer/.test(result.telegramMessage || '')) {
    throw new Error('Build Telegram Message must show high-priority inspect records in the High interest section');
  }
  if (/Manual inspection: 1/.test(result.telegramMessage || '')) {
    throw new Error('High interest records must not also be counted as manual inspection');
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
  return /\b(chief technology officer|field cto|engineering manager|director of engineering|ai\/?gen ai solution architect|ai solutions? architect|genai lead)\b/i.test(title);
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
  const strongDataPoorFailures = expectedTitles
    .filter(isStrongDataPoorTitle)
    .filter(title => {
      const record = actualRecords.find(candidate => normalizeTitle(candidate.title) === normalizeTitle(title));
      if (!record) return true;
      if (record.enrichmentStatus === 'fetched') {
        return !['inspect manually', 'apply'].includes(record.recommendedAction);
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

  return {
    file: path.basename(filePath),
    query: fixture.query,
    expectedCount: expectedJobs.length,
    parsedCount: report.parsedCount,
    matchCount: report.matchCount,
    missingTitles,
    unexpectedTitles,
    missingCanonicalUrls,
    missingEnrichedUrls,
    preheaderLeak,
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
      enrichmentStatus: record.enrichmentStatus || ''
    }))
  };
}

async function main() {
  const workflow = readJson(workflowPath);
  validateWorkflowGraph(workflow);
  await runMergeNodeUnitChecks(workflow);
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
    || result.strongDataPoorFailures.length
    || result.telegramSectionFailures.length
  );

  const summary = {
    fixtureDir,
    fixtureCount: results.length,
    expectedJobs: results.reduce((sum, result) => sum + result.expectedCount, 0),
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
