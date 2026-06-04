import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { InMemoryOperationLedger, JsonOperationLedger, buildOperationId, getOperationLedgerFilePath, hashOperationInput } from '../src/index.js';

test('operation ledger hashes inputs deterministically independent of key order', () => {
  const first = hashOperationInput({ branch: 'agent/AD-123', repository: { name: 'repo', owner: 'agentic' } });
  const second = hashOperationInput({ repository: { owner: 'agentic', name: 'repo' }, branch: 'agent/AD-123' });

  assert.equal(first, second);
  assert.equal(first.length, 64);
});

test('operation ledger records started, succeeded, and completed lookup state', async () => {
  const ledger = new InMemoryOperationLedger();
  const lookup = {
    runId: 'run-1',
    provider: 'github',
    port: 'CodeHostPort',
    action: 'openPullRequest',
    input: { sourceBranch: 'agent/AD-123', targetBranch: 'develop' }
  };
  const started = await ledger.startOperation({ ...lookup, startedAt: '2026-06-04T10:00:00.000Z' });

  assert.equal(started.operationId, buildOperationId(lookup));
  assert.equal(started.status, 'started');
  assert.equal(await ledger.findCompletedOperation(lookup), undefined);

  const succeeded = await ledger.succeedOperation({
    operationId: started.operationId,
    finishedAt: '2026-06-04T10:00:01.000Z',
    externalId: '42',
    externalUrl: 'https://github.example.test/pull/42',
    result: { number: 42 }
  });

  assert.equal(succeeded.status, 'succeeded');
  assert.equal(succeeded.externalId, '42');
  assert.deepEqual((await ledger.findCompletedOperation(lookup))?.result, { number: 42 });
  assert.equal((await ledger.listOperations()).length, 1);
});

test('operation ledger does not treat failed operations as completed', async () => {
  const ledger = new InMemoryOperationLedger();
  const lookup = {
    runId: 'run-1',
    provider: 'github',
    port: 'CodeHostPort',
    action: 'commentOnPullRequest',
    input: { pullRequest: 42, body: 'summary' }
  };
  const started = await ledger.startOperation({ ...lookup, startedAt: '2026-06-04T10:00:00.000Z' });
  const failed = await ledger.failOperation({
    operationId: started.operationId,
    finishedAt: '2026-06-04T10:00:01.000Z',
    errorSummary: 'comment rejected'
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorSummary, 'comment rejected');
  assert.equal(await ledger.findCompletedOperation(lookup), undefined);
});

test('JsonOperationLedger persists succeeded operations across instances', async (t) => {
  const rootPath = await createTempRoot(t);
  const lookup = {
    runId: 'run-1',
    provider: 'github',
    port: 'CodeHostPort',
    action: 'createBranch',
    input: { branch: 'agent/AD-123' }
  };
  const firstLedger = new JsonOperationLedger('AD-123', 'run-1', rootPath);
  const started = await firstLedger.startOperation({ ...lookup, startedAt: '2026-06-04T10:00:00.000Z' });
  await firstLedger.succeedOperation({
    operationId: started.operationId,
    finishedAt: '2026-06-04T10:00:01.000Z',
    externalId: 'agent/AD-123',
    result: { name: 'agent/AD-123' }
  });

  const secondLedger = new JsonOperationLedger('AD-123', 'run-1', rootPath);
  const completed = await secondLedger.findCompletedOperation(lookup);
  const persisted = JSON.parse(await readFile(join(rootPath, getOperationLedgerFilePath('AD-123', 'run-1')), 'utf8')) as {
    readonly operations: readonly unknown[];
  };

  assert.equal(completed?.status, 'succeeded');
  assert.deepEqual(completed?.result, { name: 'agent/AD-123' });
  assert.equal(persisted.operations.length, 1);
});

test('JsonOperationLedger does not treat reloaded failed operations as completed', async (t) => {
  const rootPath = await createTempRoot(t);
  const lookup = {
    runId: 'run-1',
    provider: 'github',
    port: 'CodeHostPort',
    action: 'commentOnPullRequest',
    input: { pullRequest: 42, body: 'summary' }
  };
  const firstLedger = new JsonOperationLedger('AD-123', 'run-1', rootPath);
  const started = await firstLedger.startOperation({ ...lookup, startedAt: '2026-06-04T10:00:00.000Z' });
  await firstLedger.failOperation({
    operationId: started.operationId,
    finishedAt: '2026-06-04T10:00:01.000Z',
    errorSummary: 'comment rejected'
  });

  const secondLedger = new JsonOperationLedger('AD-123', 'run-1', rootPath);

  assert.equal(await secondLedger.findCompletedOperation(lookup), undefined);
  assert.equal((await secondLedger.listOperations())[0]?.status, 'failed');
});

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-ledger-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}
