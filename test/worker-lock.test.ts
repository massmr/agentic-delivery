import * as assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { WorkerLockHeldError, acquireWorkerLock, getWorkerLockPath, type WorkerLockMetadata } from '../src/index.js';

test('worker lock prevents a second live worker in the same workspace', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-worker-lock-live-'));
  const lease = await acquireWorkerLock({ rootPath, pid: 111, token: 'owner', now: fixedDate });

  await assert.rejects(
    () => acquireWorkerLock({ rootPath, pid: 222, token: 'contender', now: fixedDate, isProcessAlive: () => true }),
    (error: unknown) => {
      assert.ok(error instanceof WorkerLockHeldError);
      assert.equal(error.metadata?.pid, 111);
      return true;
    }
  );

  await lease.release();
  assert.equal(existsSync(getWorkerLockPath(rootPath)), false);
});

test('worker lock release only removes the owner token', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-worker-lock-token-'));
  const lease = await acquireWorkerLock({ rootPath, pid: 111, token: 'owner', now: fixedDate });
  const replacement: WorkerLockMetadata = {
    pid: 222,
    startedAt: '2026-06-04T10:01:00.000Z',
    workspaceRoot: rootPath,
    token: 'replacement'
  };

  writeFileSync(getWorkerLockPath(rootPath), `${JSON.stringify(replacement, null, 2)}\n`, 'utf8');
  await lease.release();

  assert.equal(existsSync(getWorkerLockPath(rootPath)), true);
});

test('worker lock recovers a stale dead-pid lock', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-worker-lock-stale-'));
  const stale = await acquireWorkerLock({ rootPath, pid: 111, token: 'stale', now: fixedDate });
  const recovered: WorkerLockMetadata[] = [];

  const replacement = await acquireWorkerLock({
    rootPath,
    pid: 222,
    token: 'replacement',
    now: fixedDate,
    isProcessAlive: () => false,
    onStaleLockRecovered: (metadata) => {
      if (metadata !== undefined) {
        recovered.push(metadata);
      }
    }
  });

  assert.equal(recovered[0]?.pid, 111);
  await stale.release();
  assert.equal(existsSync(getWorkerLockPath(rootPath)), true);
  await replacement.release();
  assert.equal(existsSync(getWorkerLockPath(rootPath)), false);
});

function fixedDate(): Date {
  return new Date('2026-06-04T10:00:00.000Z');
}
