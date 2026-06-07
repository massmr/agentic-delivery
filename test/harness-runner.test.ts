import * as assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { getRunStateFilePath, runHarness } from '../src/index.js';
import type { DeliveryRunStateRecord } from '../src/index.js';

const fixturesRoot = resolve('fixtures/harness');

test('harness scores AD-101 minimal Node fixture across required dimensions', async () => {
  const result = await runHarness({ fixtureId: 'ad-101-minimal-node', fixturesRoot });
  const fixture = result.results[0];

  assert.equal(result.status, 'passed');
  assert.ok(fixture !== undefined);
  assert.equal(fixture.status, 'passed');
  assert.equal(fixture.score.passed, fixture.score.total);
  assert.equal(fixture.finalState, 'LOCAL_CHECKS_PASSED');
  assert.equal(fixture.checks.find((check) => check.name === 'meaningful diff')?.actual, 'passed');
  assert.equal(fixture.checks.find((check) => check.name === 'quality result')?.actual, 'passed');
  assert.equal((await stat(join(fixture.runDirectoryPath, 'final-report.md'))).isFile(), true);

  const state = JSON.parse(await readFile(join(fixture.workspacePath, getRunStateFilePath('AD-101', 'ad-101-minimal-node-run')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.coreSafety?.addedLineCount, 1);
  assert.equal(state.pullRequests.length, 0);
  assert.equal(state.stagingDeployments.length, 0);
});

test('--all harness run executes fixtures in stable sorted order', async () => {
  const result = await runHarness({ all: true, fixturesRoot });

  assert.deepEqual(result.results.map((fixture) => fixture.fixtureId), [
    'ad-101-minimal-node',
    'ad-101-no-meaningful-diff'
  ]);
  assert.equal(result.status, 'passed');
});

test('harness catches no-meaningful-diff false positive regression', async () => {
  const result = await runHarness({ fixtureId: 'ad-101-no-meaningful-diff', fixturesRoot });
  const fixture = result.results[0];

  assert.ok(fixture !== undefined);
  assert.equal(result.status, 'passed');
  assert.equal(fixture.finalState, 'FAILED');
  assert.equal(fixture.checks.find((check) => check.name === 'meaningful diff')?.actual, 'failed');
  assert.equal(fixture.checks.find((check) => check.name === 'quality result')?.actual, 'not_run');

  await assert.rejects(stat(join(fixture.runDirectoryPath, 'quality-report.md')));
  await assert.rejects(stat(join(fixture.runDirectoryPath, 'develop-pr.json')));
  await assert.rejects(stat(join(fixture.runDirectoryPath, 'staging-report.md')));
});

test('harness fixtures model tracked and untracked pathspec statuses', async () => {
  const tracked = JSON.parse(await readFile(join(fixturesRoot, 'ad-101-minimal-node/fixture.json'), 'utf8')) as {
    readonly agent: { readonly gitPathspecStatus: string; readonly gitTrackedDiff: string };
  };
  const untracked = JSON.parse(await readFile(join(fixturesRoot, 'ad-101-no-meaningful-diff/fixture.json'), 'utf8')) as {
    readonly agent: { readonly gitPathspecStatus: string };
  };

  assert.equal(tracked.agent.gitPathspecStatus, ' M src/message.js\n');
  assert.match(tracked.agent.gitTrackedDiff, /\+  return 'hello from AD-101';/u);
  assert.equal(untracked.agent.gitPathspecStatus, '?? .omo/session.json\n');
});

test('harness does not mutate source fixture repository', async () => {
  const sourcePath = join(fixturesRoot, 'repos/minimal-node/src/message.js');
  const before = await readFile(sourcePath, 'utf8');

  await runHarness({ fixtureId: 'ad-101-minimal-node', fixturesRoot });

  assert.equal(await readFile(sourcePath, 'utf8'), before);
});
