import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { createCliProgram } from '../src/index.js';

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

test('agentic --help prints the mock planning help output', async () => {
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ io: captured.io }).run(['node', 'agentic', '--help']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Usage:\n  agentic \[--help\]/u);
  assert.match(captured.stdout, /agentic init/u);
  assert.match(captured.stdout, /agentic scan/u);
  assert.match(captured.stdout, /agentic plan <ticket-key>/u);
  assert.match(captured.stdout, /agentic run <ticket-key>/u);
  assert.match(captured.stdout, /agentic worker \[--concurrency <n>\]/u);
  assert.match(captured.stdout, /agentic status <ticket-key>/u);
  assert.match(captured.stdout, /agentic quality <repo-path> --ticket-key <ticket-key>/u);
  assert.match(captured.stdout, /Copy config\/workspace\.example\.yml to config\/workspace\.yml/u);
  assert.match(captured.stdout, /Mock mode only/u);
  assert.equal(captured.stderr, '');
});

test('help output does not require credentials or provider configuration', async () => {
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ io: captured.io }).run(['node', 'agentic']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /agentic \[--help\]/u);
  assert.match(captured.stdout, /agentic init/u);
  assert.match(captured.stdout, /agentic worker/u);
  assert.equal(captured.stderr, '');
});

test('built agentic bin prints help when invoked through a package-manager symlink', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'agentic-bin-test-'));
  const agenticBin = join(binDir, 'agentic');
  symlinkSync(resolve('dist/src/cli/index.js'), agenticBin);

  const result = spawnSync('agentic', ['--help'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`
    }
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage:\n  agentic \[--help\]/u);
  assert.match(result.stdout, /agentic init/u);
  assert.match(result.stdout, /agentic run <ticket-key>/u);
  assert.match(result.stdout, /agentic worker/u);
  assert.match(result.stdout, /agentic status <ticket-key>/u);
  assert.match(result.stdout, /agentic quality <repo-path> --ticket-key <ticket-key>/u);
  assert.match(result.stdout, /Mock mode only/u);
});

test('agentic worker processes the mock backlog without credentials', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-worker-cli-'));
  mkdirSync(join(rootPath, 'config'));
  writeFileSync(join(rootPath, 'config', 'workspace.yml'), workerConfigYaml, 'utf8');
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: rootPath, configPath: 'config/workspace.yml', io: captured.io }).run([
    'node',
    'agentic',
    'worker',
    '--concurrency',
    '1',
    '--max-cycles',
    '1',
    '--max-attempts',
    '1'
  ]);

  assert.equal(exitCode, 2);
  assert.match(captured.stdout, /Worker Mode: mock/u);
  assert.match(captured.stdout, /Intake Mode: mock/u);
  assert.match(captured.stdout, /Provider Modes: Jira=mock, GitHub=mock, Railway=mock/u);
  assert.match(captured.stdout, /Agent worker loop completed/u);
  assert.match(captured.stdout, /Queued: 2/u);
  assert.match(captured.stdout, /Succeeded: 1/u);
  assert.match(captured.stdout, /Escalated: 1/u);
  assert.match(captured.stdout, /AD-101: succeeded/u);
  assert.match(captured.stdout, /AD-102: escalated/u);
  assert.equal(captured.stderr, '');
});

const workerConfigYaml = `
workspace:
  name: Agent Worker CLI Test
  autonomy: supervised
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
  mode: mock
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
repos:
  - name: frontend
    url: https://github.com/agentic/frontend
    local_path: ./worktrees/frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
`;
