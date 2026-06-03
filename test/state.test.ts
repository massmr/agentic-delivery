import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  JsonRunStateStore,
  createDeliveryRunStateRecord,
  getRunDirectoryPath,
  getRunStateFilePath,
  transitionDeliveryRunState,
  recordDevRunResult,
  type DeliveryRunStateRecord,
  type DevRunResult,
  type RepositoryRef,
  type TicketRef
} from '../src/index.js';

const ticket = {
  provider: 'jira',
  key: 'AD-123',
  url: 'https://jira.example.test/browse/AD-123'
} satisfies TicketRef;

const repository = {
  provider: 'github',
  owner: 'agentic',
  name: 'web-app',
  defaultBranch: 'main',
  url: 'https://github.com/agentic/web-app'
} satisfies RepositoryRef;

async function createTempRunRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-state-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

test('getRunDirectoryPath and getRunStateFilePath derive the run layout', () => {
  assert.equal(getRunDirectoryPath(ticket.key, 'run-1'), 'runs/AD-123/run-1');
  assert.equal(getRunStateFilePath(ticket.key, 'run-1'), 'runs/AD-123/run-1/state.json');
});

test('createDeliveryRunStateRecord creates the initial discoverable run state', () => {
  const createdAt = '2026-06-03T10:00:00.000Z';

  const record = createDeliveryRunStateRecord({
    runId: 'run-1',
    ticket,
    targetRepositories: [repository],
    timestamps: {
      createdAt,
      updatedAt: createdAt
    }
  }) satisfies DeliveryRunStateRecord;

  assert.deepEqual(record, {
    runId: 'run-1',
    ticket,
    state: 'DISCOVERED',
    targetRepositories: [repository],
    branches: [],
    pullRequests: [],
    stagingDeployments: [],
    qualityReports: [],
    devRuns: [],
    timestamps: {
      createdAt,
      updatedAt: createdAt
    }
  });
});

test('JsonRunStateStore persists the initial state and resumes it from disk', async (t) => {
  const rootPath = await createTempRunRoot(t);
  const store = new JsonRunStateStore(rootPath);
  const createdAt = '2026-06-03T10:00:00.000Z';
  const stateFilePath = join(rootPath, getRunStateFilePath(ticket.key, 'run-1'));
  const initialState = createDeliveryRunStateRecord({
    runId: 'run-1',
    ticket,
    targetRepositories: [repository],
    timestamps: {
      createdAt,
      updatedAt: createdAt
    }
  });

  await store.write(initialState);

  const onDisk = await readFile(stateFilePath, 'utf8');
  assert.equal(onDisk, `${JSON.stringify(initialState, null, 2)}\n`);

  const resumed = await store.read(ticket.key, 'run-1');
  assert.deepEqual(resumed, initialState);

  const fileInfo = await stat(stateFilePath);
  assert.equal(fileInfo.isFile(), true);
});

test('transitionDeliveryRunState round-trips through stable JSON formatting', async (t) => {
  const rootPath = await createTempRunRoot(t);
  const store = new JsonRunStateStore(rootPath);
  const createdAt = '2026-06-03T10:00:00.000Z';
  const plannedAt = '2026-06-03T10:05:00.000Z';
  const stateFilePath = join(rootPath, getRunStateFilePath(ticket.key, 'run-1'));
  const initialState = createDeliveryRunStateRecord({
    runId: 'run-1',
    ticket,
    targetRepositories: [repository],
    timestamps: {
      createdAt,
      updatedAt: createdAt
    }
  });
  const transitionedState = transitionDeliveryRunState(initialState, 'PLANNED', plannedAt);

  assert.equal(transitionedState.state, 'PLANNED');
  assert.equal(transitionedState.timestamps.createdAt, createdAt);
  assert.equal(transitionedState.timestamps.updatedAt, plannedAt);
  assert.deepEqual(transitionedState.ticket, ticket);

  await store.write(transitionedState);

  const onDisk = await readFile(stateFilePath, 'utf8');
  assert.equal(onDisk, `${JSON.stringify(transitionedState, null, 2)}\n`);

  const resumed = await store.read(ticket.key, 'run-1');
  assert.deepEqual(resumed, transitionedState);
});

test('recordDevRunResult appends passed implementation results without completing the run', () => {
  const createdAt = '2026-06-03T10:00:00.000Z';
  const updatedAt = '2026-06-03T10:05:00.000Z';
  const initialState = createDeliveryRunStateRecord({
    runId: 'run-1',
    ticket,
    targetRepositories: [repository],
    timestamps: {
      createdAt,
      updatedAt: createdAt
    }
  });
  const result = createDevRunResult('passed');
  const state = recordDevRunResult(initialState, result, updatedAt);

  assert.equal(state.state, 'IMPLEMENTING');
  assert.equal(state.timestamps.updatedAt, updatedAt);
  assert.equal(state.timestamps.completedAt, undefined);
  assert.deepEqual(state.devRuns, [result]);
});

test('recordDevRunResult turns failed implementation results into actionable failed state', () => {
  const createdAt = '2026-06-03T10:00:00.000Z';
  const failedAt = '2026-06-03T10:05:00.000Z';
  const initialState = createDeliveryRunStateRecord({
    runId: 'run-1',
    ticket,
    targetRepositories: [repository],
    timestamps: {
      createdAt,
      updatedAt: createdAt
    }
  });
  const result = createDevRunResult('failed');
  const state = recordDevRunResult(initialState, result, failedAt);

  assert.equal(state.state, 'FAILED');
  assert.equal(state.timestamps.completedAt, failedAt);
  assert.equal(state.failure?.state, 'IMPLEMENTING');
  assert.match(state.failure?.reason ?? '', /runs\/AD-123\/run-1\/implementation-log\.md/u);
  assert.match(state.failure?.reason ?? '', /exit code: 2/u);
  assert.deepEqual(state.devRuns, [result]);
});

function createDevRunResult(status: 'passed' | 'failed'): DevRunResult {
  const exitCode = status === 'passed' ? 0 : 2;

  return {
    provider: 'opencode',
    ticketKey: ticket.key,
    runId: 'run-1',
    repository,
    branchName: 'agent/AD-123-dev-runner',
    baseBranch: 'develop',
    command: 'node mock-opencode.js',
    workingDirectory: '/repo',
    implementationLogPath: 'runs/AD-123/run-1/implementation-log.md',
    startedAt: '2026-06-03T10:01:00.000Z',
    finishedAt: '2026-06-03T10:02:00.000Z',
    durationMs: 60000,
    attempts: [
      {
        attempt: 1,
        command: 'node mock-opencode.js',
        workingDirectory: '/repo',
        startedAt: '2026-06-03T10:01:00.000Z',
        finishedAt: '2026-06-03T10:02:00.000Z',
        durationMs: 60000,
        exitCode,
        status,
        summary: status === 'passed' ? 'Attempt 1 passed.' : 'Attempt 1 failed with exit code 2.'
      }
    ],
    status,
    summary: status === 'passed' ? 'OpenCode implementation passed after 1 attempt(s).' : 'OpenCode implementation failed after 1 attempt(s); last exit code 2.'
  };
}
