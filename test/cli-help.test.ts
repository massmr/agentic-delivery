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

test('ewokbot --help prints the mock planning help output', async () => {
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ io: captured.io }).run(['node', 'ewokbot', '--help']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Ewokbot/u);
  assert.match(captured.stdout, /ewokbot, ewok, and agentic binaries are aliases/u);
  assert.match(captured.stdout, /Usage:\n  ewokbot \[--help\]/u);
  assert.match(captured.stdout, /ewokbot init/u);
  assert.match(captured.stdout, /ewokbot auth status/u);
  assert.match(captured.stdout, /ewokbot auth login <provider>/u);
  assert.match(captured.stdout, /ewokbot auth logout <provider>/u);
  assert.match(captured.stdout, /ewokbot auth list/u);
  assert.match(captured.stdout, /ewokbot doctor/u);
  assert.match(captured.stdout, /ewokbot scan/u);
  assert.match(captured.stdout, /ewokbot ui \[--port <port>\] \[--hostname <host>\]/u);
  assert.match(captured.stdout, /ewokbot plan <ticket-key>/u);
  assert.match(captured.stdout, /ewokbot run <ticket-key>/u);
  assert.match(captured.stdout, /ewokbot run-dev <ticket-key> --confirm-dev-execution/u);
  assert.match(captured.stdout, /ewokbot smoke <ticket-key> --confirm-real-provider-smoke/u);
  assert.match(captured.stdout, /ewokbot runs/u);
  assert.match(captured.stdout, /ewokbot inspect <run-id>/u);
  assert.match(captured.stdout, /ewokbot pause/u);
  assert.match(captured.stdout, /ewokbot resume <run-id>/u);
  assert.match(captured.stdout, /ewokbot approve <run-id>/u);
  assert.match(captured.stdout, /ewokbot reject <run-id>/u);
  assert.match(captured.stdout, /ewokbot logs <run-id>/u);
  assert.match(captured.stdout, /ewokbot worker start \[--once\] \[--dry-run\]/u);
  assert.match(captured.stdout, /ewokbot worker \[--concurrency <n>\].*\(legacy\)/u);
  assert.match(captured.stdout, /ewokbot status <ticket-key>/u);
  assert.match(captured.stdout, /ewokbot quality <repo-path> --ticket-key <ticket-key>/u);
  assert.match(captured.stdout, /ewokbot harness run <fixture-id>/u);
  assert.match(captured.stdout, /ewokbot harness run --all/u);
  assert.match(
    captured.stdout,
    /Create \.ewokbot\/workspace\.yml, \.ewokbot\/\.env, and \.ewokbot\/\.env\.example/u
  );
  assert.match(captured.stdout, /Mock mode remains the default/u);
  assert.equal(captured.stderr, '');
});

test('no-command output does not require credentials and points to setup', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-no-command-missing-'));
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ cwd: rootPath, io: captured.io }).run(['node', 'agentic']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /No command provided/u);
  assert.match(captured.stdout, /Run ewokbot init/u);
  assert.match(captured.stdout, /ewokbot \[--help\]/u);
  assert.match(captured.stdout, /ewokbot init/u);
  assert.match(captured.stdout, /ewokbot worker/u);
  assert.equal(captured.stderr, '');
});

test('no-command output points configured workspaces to operational commands', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-no-command-ready-'));
  const captured = createCapturedIO();

  mkdirSync(join(rootPath, '.ewokbot'));
  writeFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), workerConfigYaml, 'utf8');

  const exitCode = await createCliProgram({ cwd: rootPath, io: captured.io }).run(['node', 'ewokbot']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /No command provided/u);
  assert.match(captured.stdout, /Run ewokbot doctor/u);
  assert.match(captured.stdout, /ewokbot worker/u);
  assert.match(captured.stdout, /ewokbot status/u);
  assert.doesNotMatch(captured.stdout, /Run ewokbot init to create/u);
  assert.match(captured.stdout, /ewokbot \[--help\]/u);
  assert.equal(captured.stderr, '');
});

test('built ewokbot bin prints help when invoked through a package-manager symlink', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'agentic-bin-test-'));
  const ewokbotBin = join(binDir, 'ewokbot');
  symlinkSync(resolve('dist/src/cli/index.js'), ewokbotBin);

  const result = spawnSync('ewokbot', ['--help'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`
    }
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage:\n  ewokbot \[--help\]/u);
  assert.match(result.stdout, /ewokbot init/u);
  assert.match(result.stdout, /ewokbot auth status/u);
  assert.match(result.stdout, /ewokbot ui \[--port <port>\] \[--hostname <host>\]/u);
  assert.match(result.stdout, /ewokbot run <ticket-key>/u);
  assert.match(result.stdout, /ewokbot run-dev <ticket-key> --confirm-dev-execution/u);
  assert.match(result.stdout, /ewokbot smoke <ticket-key> --confirm-real-provider-smoke/u);
  assert.match(result.stdout, /ewokbot runs/u);
  assert.match(result.stdout, /ewokbot inspect <run-id>/u);
  assert.match(result.stdout, /ewokbot worker/u);
  assert.match(result.stdout, /ewokbot status <ticket-key>/u);
  assert.match(result.stdout, /ewokbot quality <repo-path> --ticket-key <ticket-key>/u);
  assert.match(result.stdout, /ewokbot harness run <fixture-id>/u);
  assert.match(result.stdout, /Mock mode remains the default/u);
});

test('built ewok alias prints help when invoked through a package-manager symlink', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'ewok-bin-test-'));
  const ewokBin = join(binDir, 'ewok');
  symlinkSync(resolve('dist/src/cli/index.js'), ewokBin);

  const result = spawnSync('ewok', ['--help'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`
    }
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /ewokbot, ewok, and agentic binaries are aliases/u);
  assert.match(result.stdout, /ewokbot doctor/u);
  assert.match(result.stdout, /Mock mode remains the default/u);
});

test('agentic worker processes the mock backlog without credentials', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-worker-cli-'));
  const repoPath = join(rootPath, 'frontend');
  const captured = createCapturedIO();
  const program = createCliProgram({ cwd: rootPath, io: captured.io });

  mkdirSync(join(repoPath, '.git'), { recursive: true });
  writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }), 'utf8');

  const initExitCode = await program.run([
    'node',
    'agentic',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'railway'
  ]);

  const exitCode = await program.run([
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

  assert.equal(initExitCode, 0);
  assert.equal(exitCode, 2);
  assert.match(captured.stdout, /Created .*.ewokbot\/workspace\.yml/u);
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
    local_path: ./frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
`;
