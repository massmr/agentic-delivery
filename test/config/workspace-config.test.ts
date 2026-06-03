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
  assert.equal(config.devRunner.mode, 'mock');
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
    hints: ['frontend', 'ui', 'web', 'next'],
    stagingSmokeUrls: ['/', '/health']
  });
});

test('workspace repository config parses staging_smoke_urls and permits an empty array', () => {
  const config = parseWorkspaceConfig(`
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
`);

  assert.deepEqual(config.repos[0]?.stagingSmokeUrls, []);
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

test('workspace config accepts real provider modes without creating live adapters', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const realProviderSource = source
    .replace('jira:\n  mode: mock', 'jira:\n  mode: real')
    .replace('github:\n  mode: mock', 'github:\n  mode: real')
    .replace('railway:\n  mode: mock', 'railway:\n  mode: real')
    .replace('dev_runner:\n  provider: opencode', 'dev_runner:\n  mode: real\n  provider: opencode');

  const config = parseWorkspaceConfig(realProviderSource);

  assert.equal(config.jira.mode, 'real');
  assert.equal(config.github.mode, 'real');
  assert.equal(config.railway.mode, 'real');
  assert.equal(config.devRunner.mode, 'real');
});

test('workspace config rejects unknown provider modes', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const invalidProviderSource = source.replace('jira:\n  mode: mock', 'jira:\n  mode: live');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(invalidProviderSource));

  assert.ok(error.issues.some((issue) => issue.path === 'jira.mode'));
  assert.match(error.message, /jira\.mode must be 'mock' or 'real'/u);
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
