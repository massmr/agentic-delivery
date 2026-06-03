import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { loadWorkspaceConfig, parseWorkspaceConfig, WorkspaceConfigError } from '../../src/index.js';

const exampleConfigPath = resolve('config/workspace.example.yml');

function captureWorkspaceConfigError(run: () => void): WorkspaceConfigError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof WorkspaceConfigError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected WorkspaceConfigError to be thrown.');
}

test('loads and validates config/workspace.example.yml', async () => {
  const config = await loadWorkspaceConfig(exampleConfigPath);

  assert.equal(config.workspace.name, 'la-kreme');
  assert.equal(config.workspace.maxConcurrentTickets, 1);
  assert.equal(config.jira.mode, 'mock');
  assert.deepEqual(config.jira.projectKeys, ['LK']);
  assert.equal(config.github.mode, 'mock');
  assert.equal(config.railway.mode, 'mock');
  assert.equal(config.devRunner.provider, 'opencode');
  assert.equal(config.devRunner.maxAttempts, 2);
  assert.equal(config.quality.defaultProfile, 'node');
  assert.equal(config.repos.length, 2);
  assert.deepEqual(config.repos[0], {
    name: 'frontend',
    url: 'git@github.com:your-org/frontend.git',
    localPath: '../frontend',
    defaultBranch: 'develop',
    productionBranch: 'main',
    qualityProfile: 'node',
    hints: ['frontend', 'ui', 'web', 'next']
  });
});

test('invalid YAML reports a clear syntax issue', () => {
  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig('workspace:\n  name: [unterminated'));

  assert.equal(error.issues[0]?.path, 'yaml');
  assert.match(error.message, /YAML syntax error/u);
  assert.match(error.message, /Fix the YAML syntax/u);
});

test('missing required field reports path and action', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const missingFieldSource = source.replace('  max_concurrent_tickets: 1\n', '');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(missingFieldSource));

  assert.ok(error.issues.some((issue) => issue.path === 'workspace.max_concurrent_tickets'));
  assert.match(error.message, /workspace\.max_concurrent_tickets must be a positive integer/u);
  assert.match(error.message, /Set workspace\.max_concurrent_tickets to a whole number greater than 0/u);
});

test('real provider mode is rejected during Milestone B', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const realProviderSource = source.replace('jira:\n  mode: mock', 'jira:\n  mode: real');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(realProviderSource));

  assert.ok(error.issues.some((issue) => issue.path === 'jira.mode'));
  assert.match(error.message, /jira\.mode must be 'mock' for Milestone B/u);
  assert.match(error.message, /real provider integrations are not enabled in Milestone B/u);
});

test('bad repository entry reports the exact repo field path', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const badRepoSource = source.replace('    local_path: ../api\n', '    local_path: ""\n').replace('      - database\n', '      - ""\n');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(badRepoSource));

  assert.ok(error.issues.some((issue) => issue.path === 'repos[1].local_path'));
  assert.ok(error.issues.some((issue) => issue.path === 'repos[1].hints[3]'));
  assert.match(error.message, /repos\[1\]\.local_path must be a non-empty string/u);
  assert.match(error.message, /Add at least one non-empty repository hint/u);
});
