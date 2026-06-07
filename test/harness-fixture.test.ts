import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { HarnessFixtureError, parseHarnessFixture } from '../src/index.js';

test('valid harness fixture parses into typed model', async () => {
  const fixturePath = resolve('fixtures/harness/ad-101-minimal-node/fixture.json');
  const fixture = parseHarnessFixture(await readFile(fixturePath, 'utf8'), fixturePath);

  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.id, 'ad-101-minimal-node');
  assert.equal(fixture.ticket.key, 'AD-101');
  assert.equal(fixture.repositories[0]?.name, 'minimal-node');
  assert.equal(fixture.agent.gitPathspecStatus, ' M src/message.js\n');
  assert.match(fixture.agent.gitTrackedDiff, /\+\+\+ b\/src\/message\.js/u);
  assert.match(fixture.agent.gitTrackedDiff, /\+  return 'hello from AD-101';/u);
  assert.equal(fixture.expected.meaningfulDiff, 'passed');
});

test('invalid harness fixture reports missing expected outcomes', () => {
  const source = JSON.stringify({
    schemaVersion: 1,
    id: 'invalid',
    description: 'Invalid fixture',
    ticket: {
      key: 'AD-999',
      summary: 'Invalid',
      description: 'Invalid',
      labels: []
    },
    repositories: [
      {
        name: 'minimal-node',
        sourcePath: join('repos', 'minimal-node'),
        hints: [],
        qualityProfile: 'node'
      }
    ],
    agent: {
      status: 'completed',
      changedFiles: [],
      fileWrites: [],
      testsRun: 'node --test',
      knownLimits: 'none',
      blockers: 'none',
      backgroundAgents: 'none',
      gitAfterStatus: '',
      gitAfterDiffStat: '',
      gitTrackedDiff: ''
    }
  });

  assert.throws(() => parseHarnessFixture(source, 'invalid.json'), HarnessFixtureError);
});
