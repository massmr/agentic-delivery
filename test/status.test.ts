import * as assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  JsonRunStateStore,
  assertStateResumable,
  canResumeState,
  createCliProgram,
  createDeliveryRunStateRecord,
  deliveryRunStates,
  findLatestRunState,
  getNextActionForState,
  getRunStateFilePath,
  loadRunStatus,
  readRunState,
  renderRunStatus,
  transitionDeliveryRunState,
  type BranchRef,
  type DeliveryRunState,
  type DeliveryRunStateRecord,
  type DeploymentResult,
  type PullRequestRef,
  type QualityReport,
  type RepositoryRef,
  type TicketRef
} from '../src/index.js';

const ticket = {
  provider: 'jira',
  key: 'LK-101',
  url: 'https://jira.example.test/browse/LK-101'
} satisfies TicketRef;

const repository = {
  provider: 'github',
  owner: 'agentic',
  name: 'frontend',
  defaultBranch: 'develop',
  url: 'https://github.com/agentic/frontend'
} satisfies RepositoryRef;

const branch = {
  repository,
  name: 'agent/LK-101-empty-state',
  baseBranch: 'develop',
  headSha: 'abc123'
} satisfies BranchRef;

const developPullRequest = {
  provider: 'github',
  repositoryOwner: repository.owner,
  repositoryName: repository.name,
  number: 101,
  title: 'LK-101 Improve frontend onboarding empty state',
  sourceBranch: branch.name,
  targetBranch: 'develop',
  url: 'https://mock-github.local/agentic/frontend/pull/101',
  status: 'open'
} satisfies PullRequestRef;

const qualityReport = {
  status: 'passed',
  required: [
    {
      name: 'test',
      command: 'mock quality gates',
      workingDirectory: '/workspace/frontend',
      startedAt: '2026-06-03T10:01:00.000Z',
      finishedAt: '2026-06-03T10:01:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      stdoutLogPath: '.ewokbot/runs/LK-101/run-1/quality-logs/test.stdout.log',
      stderrLogPath: '.ewokbot/runs/LK-101/run-1/quality-logs/test.stderr.log',
      status: 'passed',
      summary: 'Mock local quality gates passed.'
    }
  ],
  optional: []
} satisfies QualityReport;

const stagingDeployment = {
  ref: {
    provider: 'railway',
    projectId: 'mock-project-agentic',
    serviceId: 'mock-service-frontend',
    deploymentId: 'mock-agentic-frontend-staging-develop-abc123',
    environment: 'staging'
  },
  status: 'success',
  branch: 'develop',
  commitSha: 'abc123',
  serviceUrl: 'https://frontend-staging.mock-railway.local',
  smokeChecks: [
    {
      url: 'https://frontend-staging.mock-railway.local/health',
      status: 'passed',
      statusCode: 200,
      summary: 'Mock smoke check passed for /health.'
    }
  ],
  startedAt: '2026-06-03T10:02:00.000Z',
  finishedAt: '2026-06-03T10:03:00.000Z',
  summary: 'Mock Railway deployment success for agentic/frontend on develop.'
} satisfies DeploymentResult;

test('readRunState loads an explicit run state and reports actionable missing state errors', async (t) => {
  const rootPath = await createTempRoot(t);
  const state = createState('LOCAL_CHECKS_PASSED', 'run-1', '2026-06-03T10:00:00.000Z');

  await new JsonRunStateStore(rootPath).write(state);

  assert.deepEqual(await readRunState(rootPath, ticket.key, state.runId), state);
  await assert.rejects(readRunState(rootPath, ticket.key, 'missing-run'), /No run state found for LK-101 run missing-run/u);
});

test('findLatestRunState lists run ids and selects the latest updated state for a ticket', async (t) => {
  const rootPath = await createTempRoot(t);
  const store = new JsonRunStateStore(rootPath);
  const older = createState('PLANNED', 'run-a', '2026-06-03T10:00:00.000Z');
  const newer = createState('PRODUCTION_PR_OPENED', 'run-b', '2026-06-03T11:00:00.000Z');

  await store.write(newer);
  await store.write(older);

  const result = await findLatestRunState(rootPath, ticket.key);

  assert.equal(result.selectedRunId, 'run-b');
  assert.deepEqual(result.runIds, ['run-a', 'run-b']);
  assert.equal(result.state.state, 'PRODUCTION_PR_OPENED');
});

test('loadRunStatus selects explicit run id when provided and latest run when omitted', async (t) => {
  const rootPath = await createTempRoot(t);
  const store = new JsonRunStateStore(rootPath);

  await store.write(createState('PLANNED', 'run-a', '2026-06-03T10:00:00.000Z'));
  await store.write(createState('STAGING_VERIFIED', 'run-b', '2026-06-03T11:00:00.000Z'));

  assert.equal((await loadRunStatus({ rootPath, ticketKey: ticket.key })).selectedRunId, 'run-b');
  assert.equal((await loadRunStatus({ rootPath, ticketKey: ticket.key, runId: 'run-a' })).selectedRunId, 'run-a');
  await assert.rejects(loadRunStatus({ rootPath, ticketKey: 'NOPE-1' }), /No runs found for NOPE-1/u);
});

test('renderRunStatus summarizes state, repositories, branches, PRs, quality, staging, failures, and human action', () => {
  const state = {
    ...createState('FAILED', 'run-1', '2026-06-03T10:00:00.000Z'),
    failure: {
      state: 'STAGING_DEPLOYING',
      reason: 'Smoke check failed.',
      occurredAt: '2026-06-03T10:04:00.000Z'
    },
    humanActionNeeded: {
      reason: 'Review failed smoke check.',
      requestedAt: '2026-06-03T10:04:00.000Z'
    },
    meaningfulDiff: {
      decision: 'failed',
      reason: 'OpenCode reported success, but new changes after the pre-OpenCode baseline were only ignored agent/runtime artifacts and no product file changes.',
      baselineChangedFiles: [],
      afterAgentChangedFiles: ['.omo/session.json'],
      newChangedFiles: ['.omo/session.json'],
      changedFiles: ['.omo/session.json'],
      productFiles: [],
      ignoredFiles: ['.omo/session.json'],
      ignoredPathPatterns: ['.omo/**', '.ewokbot/**'],
      baselineDiffSummary: '',
      afterAgentDiffSummary: '',
      diffSummary: ''
    }
  } satisfies DeliveryRunStateRecord;
  const rendered = renderRunStatus(state, ['run-1', 'run-2']);

  assert.match(rendered, /# Run Status LK-101/u);
  assert.match(rendered, /Available Runs: run-1, run-2/u);
  assert.match(rendered, /State: FAILED/u);
  assert.match(rendered, /Next Action: Inspect the failure/u);
  assert.match(rendered, /agentic\/frontend \(develop\)/u);
  assert.match(rendered, /agent\/LK-101-empty-state from develop @ abc123/u);
  assert.match(rendered, /#101: agent\/LK-101-empty-state -> develop \(open\)/u);
  assert.match(rendered, /Status: PASSED/u);
  assert.match(rendered, /test PASSED/u);
  assert.match(rendered, /Meaningful Diff/u);
  assert.match(rendered, /Decision: FAILED/u);
  assert.match(rendered, /Baseline Changed Files: none/u);
  assert.match(rendered, /Agent-New Changed Files: \.omo\/session\.json/u);
  assert.match(rendered, /Agent Product Changed Files: none/u);
  assert.match(rendered, /Agent Ignored Files: \.omo\/session\.json/u);
  assert.match(rendered, /Deployment: mock-agentic-frontend-staging-develop-abc123/u);
  assert.match(rendered, /Smoke check failed/u);
  assert.match(rendered, /Review failed smoke check/u);
});

test('getNextActionForState returns deterministic guidance for every lifecycle state', () => {
  for (const state of deliveryRunStates) {
    const action = getNextActionForState(createState(state, 'run-1', '2026-06-03T10:00:00.000Z'));

    assert.equal(typeof action, 'string');
    assert.notEqual(action.trim(), '');
  }
});

test('resume guard covers every lifecycle state and blocks terminal or human-gated states', () => {
  const nonResumableStates = new Set<DeliveryRunState>(['FAILED', 'NEEDS_HUMAN', 'SKIPPED', 'PRODUCTION_PR_OPENED', 'DONE']);

  for (const state of deliveryRunStates) {
    const record = createState(state, 'run-1', '2026-06-03T10:00:00.000Z');

    assert.equal(canResumeState(record), !nonResumableStates.has(state), `${state} resume policy`);

    if (nonResumableStates.has(state)) {
      assert.throws(() => assertStateResumable(record), new RegExp(`cannot resume automatically from ${state}`, 'u'));
    } else {
      assert.doesNotThrow(() => assertStateResumable(record));
    }
  }
});

test('resume guard gives explicit reasons for blocked automatic resume states', () => {
  assert.throws(() => assertStateResumable(createState('FAILED', 'run-1', '2026-06-03T10:00:00.000Z')), /failure must be inspected/u);
  assert.throws(() => assertStateResumable(createState('NEEDS_HUMAN', 'run-1', '2026-06-03T10:00:00.000Z')), /human input is required/u);
  assert.throws(() => assertStateResumable(createState('SKIPPED', 'run-1', '2026-06-03T10:00:00.000Z')), /intentionally skipped/u);
  assert.throws(() => assertStateResumable(createState('PRODUCTION_PR_OPENED', 'run-1', '2026-06-03T10:00:00.000Z')), /production approval is human-only/u);
});

test('agentic status prints latest run status and supports explicit run id', async (t) => {
  const rootPath = await createTempRoot(t);
  const store = new JsonRunStateStore(rootPath);
  const capturedLatest = createCapturedIO();
  const capturedExplicit = createCapturedIO();

  await store.write(createState('PLANNED', 'run-a', '2026-06-03T10:00:00.000Z'));
  await store.write(createState('PRODUCTION_PR_OPENED', 'run-b', '2026-06-03T11:00:00.000Z'));

  const latestExitCode = await createCliProgram({ cwd: rootPath, io: capturedLatest.io }).run(['node', 'agentic', 'status', ticket.key]);
  const explicitExitCode = await createCliProgram({ cwd: rootPath, io: capturedExplicit.io }).run([
    'node',
    'agentic',
    'status',
    ticket.key,
    '--run-id',
    'run-a'
  ]);

  assert.equal(latestExitCode, 0);
  assert.match(capturedLatest.stdout, /Run ID: run-b/u);
  assert.match(capturedLatest.stdout, /State: PRODUCTION_PR_OPENED/u);
  assert.match(capturedLatest.stdout, /Available Runs: run-a, run-b/u);
  assert.equal(capturedLatest.stderr, '');
  assert.equal(explicitExitCode, 0);
  assert.match(capturedExplicit.stdout, /Run ID: run-a/u);
  assert.match(capturedExplicit.stdout, /State: PLANNED/u);
});

test('agentic status exits non-zero with an actionable missing run message', async (t) => {
  const rootPath = await createTempRoot(t);
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ cwd: rootPath, io: captured.io }).run(['node', 'agentic', 'status', ticket.key]);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /No runs found for LK-101/u);
  assert.equal(captured.stdout, '');
});

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-status-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

function createState(state: DeliveryRunState, runId: string, updatedAt: string): DeliveryRunStateRecord {
  const initial = createDeliveryRunStateRecord({
    runId,
    ticket,
    targetRepositories: [repository],
    timestamps: {
      createdAt: '2026-06-03T09:00:00.000Z',
      updatedAt: '2026-06-03T09:00:00.000Z'
    },
    ticketAnalysis: {
      ticketKey: ticket.key,
      goal: 'Improve frontend onboarding empty state',
      requirements: ['Improve the empty state.'],
      constraints: ['Keep production human-only.'],
      risks: ['Visual copy could need review.']
    }
  });

  return {
    ...transitionDeliveryRunState(initial, state, updatedAt),
    branches: [branch],
    pullRequests: [developPullRequest],
    stagingDeployments: [stagingDeployment],
    qualityReports: [qualityReport]
  };
}

function createCapturedIO() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout(text: string) {
        stdout += text;
      },
      stderr(text: string) {
        stderr += text;
      }
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}
