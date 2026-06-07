import * as assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { createCliProgram } from '../src/index.js';
import type { CliProgramIO } from '../src/index.js';

test('harness command runs one fixture with readable local-only output', async () => {
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ io: captured.io, harnessFixturesRoot: resolve('fixtures/harness') }).run([
    'node',
    'ewokbot',
    'harness',
    'run',
    'ad-101-minimal-node'
  ]);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Fixture \| Status \| Score \| Final State \| Evidence/u);
  assert.match(captured.stdout, /ad-101-minimal-node \| passed \|/u);
  assert.match(captured.stdout, /Harness result: PASSED/u);
  assert.match(captured.stdout, /Local-only boundary preserved/u);
  assert.equal(captured.stderr, '');
});

test('harness command runs all fixtures', async () => {
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ io: captured.io, harnessFixturesRoot: resolve('fixtures/harness') }).run([
    'node',
    'ewokbot',
    'harness',
    'run',
    '--all'
  ]);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /ad-101-minimal-node \| passed/u);
  assert.match(captured.stdout, /ad-101-no-meaningful-diff \| passed/u);
  assert.equal(captured.stderr, '');
});

test('harness command returns actionable error for unknown fixture', async () => {
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ io: captured.io, harnessFixturesRoot: resolve('fixtures/harness') }).run([
    'node',
    'ewokbot',
    'harness',
    'run',
    'missing-fixture'
  ]);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /Harness run failed/u);
  assert.match(captured.stderr, /Available fixtures: ad-101-minimal-node, ad-101-no-meaningful-diff/u);
});

function createCapturedIO(): { readonly io: CliProgramIO; readonly stdout: string; readonly stderr: string } {
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
