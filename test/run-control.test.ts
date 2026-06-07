import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  JsonRunControlStore,
  JsonRunStateStore,
  createDeliveryRunStateRecord,
  getRunControlFilePath,
  getRunStateFilePath,
  getWorkspaceControlFilePath,
  renderRunInspection,
  renderRunLogs,
  renderRunsList,
  transitionDeliveryRunState,
  type DeliveryRunState,
  type DeliveryRunStateRecord,
  type QualityReport,
  type RepositoryRef,
  type TestRelevanceReport,
  type TicketRef
} from '../src/index.js';

const ticket = {
  provider: 'jira',
  key: 'AD-201',
  url: 'https://jira.example.test/browse/AD-201'
} satisfies TicketRef;

const repository = {
  provider: 'github',
  owner: 'agentic',
  name: 'control-plane',
  defaultBranch: 'develop',
  url: 'https://github.com/agentic/control-plane'
} satisfies RepositoryRef;

const qualityReport = {
  status: 'passed',
  required: [
    {
      name: 'test',
      command: 'pnpm test',
      workingDirectory: '/workspace/control-plane',
      startedAt: '2026-06-04T10:00:00.000Z',
      finishedAt: '2026-06-04T10:00:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      stdoutLogPath: '.ewokbot/runs/AD-201/run-a/quality-logs/test.stdout.log',
      stderrLogPath: '.ewokbot/runs/AD-201/run-a/quality-logs/test.stderr.log',
      status: 'passed',
      summary: 'Tests passed.'
    }
  ],
  optional: []
} satisfies QualityReport;

const testRelevanceReport = {
  decision: 'pass',
  reason: 'Realistic local test evidence was reported and passed for product changes.',
  changedFiles: ['src/control.ts'],
  testsReported: ['Tests run: pnpm test'],
  qualityCommands: [
    {
      name: 'test',
      command: 'pnpm test',
      requirement: 'required',
      status: 'passed',
      relevant: true,
      trivial: false
    }
  ],
  findings: [
    {
      kind: 'realistic_test_command',
      severity: 'info',
      message: 'Realistic test command evidence found: pnpm test.'
    }
  ],
  trivialCommandPatterns: ['mock test']
} satisfies TestRelevanceReport;

test('JsonRunControlStore persists workspace pause, resume intent, and decision sidecars', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunControlStore(rootPath);
  const state = createState('STAGING_VERIFIED', 'run-a', ticket.key);
  const runStore = new JsonRunStateStore(rootPath);

  await runStore.write(state);

  const paused = await store.pauseWorkspace('Operator maintenance window.', new Date('2026-06-04T10:01:00.000Z'));
  assert.equal(paused.paused, true);
  assert.equal(await store.isWorkspacePaused(), true);
  assert.deepEqual(JSON.parse(readFileSync(join(rootPath, getWorkspaceControlFilePath()), 'utf8')) as unknown, paused);

  const lookup = await store.resolveRun('run-a');
  const resume = await store.writeResumeIntent(lookup, new Date('2026-06-04T10:02:00.000Z'));
  const cleared = await store.clearWorkspacePause(new Date('2026-06-04T10:03:00.000Z'));
  assert.equal(resume.resume?.state, 'STAGING_VERIFIED');
  assert.match(resume.resume?.nextAction ?? '', /Prepare the production pull request/u);
  assert.equal(cleared.paused, false);

  const productionState = createState('PRODUCTION_PR_OPENED', 'run-prod', ticket.key);
  await runStore.write(productionState);
  const decision = await store.writeDecision(await store.resolveRun('run-prod'), 'approved', new Date('2026-06-04T10:04:00.000Z'));
  assert.equal(decision.decision?.decision, 'approved');
  assert.equal(decision.decision?.note, 'Local operator decision only; no merge or deployment was performed.');
  assert.deepEqual(JSON.parse(readFileSync(join(rootPath, getRunControlFilePath(ticket.key, 'run-prod')), 'utf8')) as unknown, decision);
});

test('JsonRunControlStore scans run ids, ignores non-run entries, and detects missing or duplicate ids', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunControlStore(rootPath);
  const runStore = new JsonRunStateStore(rootPath);

  await runStore.write(createState('PLANNED', 'shared-run', 'AD-201'));
  await runStore.write(createState('LOCAL_CHECKS_PASSED', 'run-b', 'AD-202'));
  mkdirSync(join(rootPath, '.ewokbot', 'runs'), { recursive: true });
  writeFileSync(join(rootPath, '.ewokbot', 'runs', 'worker.lock'), '{}\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'runs', 'control.json'), '{}\n', 'utf8');

  const runs = await store.listRuns();
  assert.deepEqual(
    runs.map((run) => `${run.ticketKey}/${run.runId}`),
    ['AD-202/run-b', 'AD-201/shared-run']
  );
  assert.equal((await store.resolveRun('run-b')).ticketKey, 'AD-202');
  await assert.rejects(store.resolveRun('missing-run'), /No run found for run id missing-run/u);

  await runStore.write(createState('STAGING_VERIFIED', 'shared-run', 'AD-203'));
  await assert.rejects(store.resolveRun('shared-run'), /ambiguous across tickets: AD-201, AD-203/u);
});

test('control renderers produce SSH-readable run lists, inspection, and logs', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunControlStore(rootPath);
  const runStore = new JsonRunStateStore(rootPath);
  const state = createState('LOCAL_CHECKS_PASSED', 'run-a', ticket.key);

  await runStore.write(state);
  await store.writeResumeIntent(await store.resolveRun('run-a'), new Date('2026-06-04T10:05:00.000Z'));
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'run-a', 'plan.md'), 'Plan contents\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'run-a', 'test-relevance.json'), JSON.stringify(testRelevanceReport, null, 2), 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'run-a', 'quality-report.md'), 'Quality report\n', 'utf8');
  mkdirSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'run-a', 'quality-logs'), { recursive: true });
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'run-a', 'quality-logs', 'test.stdout.log'), 'stdout log\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'run-a', 'quality-logs', 'test.stderr.log'), 'stderr log\n', 'utf8');

  assert.match(renderRunsList(await store.listRuns()), /Run ID \| Ticket \| State \| Updated \| Decision \| Next Action/u);
  assert.match(renderRunsList([]), /No runs found under \.ewokbot\/runs/u);

  const inspection = await renderRunInspection(store, await store.resolveRun('run-a'));
  assert.match(inspection, /Run Directory: .ewokbot\/runs\/AD-201\/run-a/u);
  assert.match(inspection, /test-relevance\.json/u);
  assert.match(inspection, /Resume Requested At: 2026-06-04T10:05:00.000Z/u);
  assert.match(inspection, /Human-only Production Note/u);

  const logs = renderRunLogs(await store.readRunLogs('run-a'));
  assert.match(logs, /## Plan/u);
  assert.match(logs, /Plan contents/u);
  assert.match(logs, /## Test Relevance/u);
  assert.match(logs, /Realistic local test evidence/u);
  assert.match(logs, /## Implementation Log/u);
  assert.match(logs, /not found/u);
  assert.match(logs, /Quality Stdout .ewokbot\/runs\/AD-201\/run-a\/quality-logs\/test.stdout.log/u);
  assert.match(logs, /stdout log/u);
  assert.match(logs, /stderr log/u);
});

test('run logs block relative paths that escape the run directory', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunControlStore(rootPath);
  const runStore = new JsonRunStateStore(rootPath);
  const secret = 'EWOKBOT_SECRET=do-not-print';
  const state = createState('LOCAL_CHECKS_PASSED', 'run-a', ticket.key);

  writeFileSync(join(rootPath, 'secret.txt'), `${secret}\n`, 'utf8');
  await runStore.write({
    ...state,
    devRuns: state.devRuns.map((devRun) => ({
      ...devRun,
      implementationLogPath: '../../../secret.txt'
    }))
  });

  const logs = renderRunLogs(await store.readRunLogs('run-a'));

  assert.doesNotMatch(logs, new RegExp(secret, 'u'));
  assert.match(logs, /blocked unsafe log path/u);
});

test('run logs block absolute paths outside the run directory', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunControlStore(rootPath);
  const runStore = new JsonRunStateStore(rootPath);
  const secret = 'ABSOLUTE_SECRET=do-not-print';
  const secretPath = join(rootPath, '.ewokbot', '.env');
  const state = createState('LOCAL_CHECKS_PASSED', 'run-a', ticket.key);

  mkdirSync(join(rootPath, '.ewokbot'), { recursive: true });
  writeFileSync(secretPath, `${secret}\n`, 'utf8');
  await runStore.write({
    ...state,
    qualityReports: [
      {
        ...qualityReport,
        required: qualityReport.required.map((gate) => ({
          ...gate,
          stdoutLogPath: secretPath
        }))
      }
    ]
  });

  const logs = renderRunLogs(await store.readRunLogs('run-a'));

  assert.doesNotMatch(logs, new RegExp(secret, 'u'));
  assert.match(logs, /blocked unsafe log path/u);
});

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'agentic-run-control-'));
}

function createState(state: DeliveryRunState, runId: string, ticketKey: string): DeliveryRunStateRecord {
  const timestamp = runId === 'run-b' ? '2026-06-04T10:30:00.000Z' : '2026-06-04T10:00:00.000Z';
  const initial = createDeliveryRunStateRecord({
    runId,
    ticket: { ...ticket, key: ticketKey, url: `https://jira.example.test/browse/${ticketKey}` },
    targetRepositories: [repository],
    timestamps: { createdAt: timestamp, updatedAt: timestamp },
    ticketAnalysis: { ticketKey, goal: 'Add CLI control plane', requirements: [], constraints: ['No production automation.'], risks: [] }
  });

  return {
    ...transitionDeliveryRunState(initial, state, timestamp),
    qualityReports: runId === 'run-a' ? [{ ...qualityReport, testRelevance: testRelevanceReport }] : [],
    testRelevance: runId === 'run-a' ? testRelevanceReport : undefined,
    devRuns:
      runId === 'run-a'
        ? [
            {
              provider: 'opencode',
              ticketKey,
              runId,
              repository,
              branchName: 'agent/AD-201-control-plane',
              baseBranch: 'develop',
              command: 'opencode run',
              workingDirectory: '/workspace/control-plane',
              implementationLogPath: getRunStateFilePath(ticketKey, runId).replace('state.json', 'implementation-log.md'),
              startedAt: timestamp,
              finishedAt: timestamp,
              durationMs: 1,
              attempts: [],
              status: 'passed',
              summary: 'Implementation completed.'
            }
          ]
        : []
  };
}
