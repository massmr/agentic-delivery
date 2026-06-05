import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { createCliProgram, parseWorkspaceConfig } from '../src/index.js';

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

test('agentic init creates non-interactive onboarding files in the current directory', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-test-'));
  const cliPath = resolve('dist/src/cli/index.js');
  const result = spawnSync(process.execPath, [cliPath, 'init', '--non-interactive'], {
    cwd: workspaceDir,
    encoding: 'utf8'
  });

  const targetPath = join(workspaceDir, '.ewokbot', 'workspace.yml');
  const envPath = join(workspaceDir, '.ewokbot', '.env.example');

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Created .+.ewokbot\/workspace\.yml/u);
  assert.match(result.stdout, /Created .+\.env\.example/u);
  const workspaceYaml = readFileSync(targetPath, 'utf8');
  const config = parseWorkspaceConfig(workspaceYaml);
  assert.match(workspaceYaml, /deployment_monitors:\n    - railway/u);
  assert.match(workspaceYaml, /repos:\n  discovery: sibling-git-directories\n  exclude: \[\]/u);
  assert.doesNotMatch(workspaceYaml, /name: frontend/u);
  assert.doesNotMatch(workspaceYaml, /local_path: \.\/frontend/u);
  assert.doesNotMatch(workspaceYaml, /https:\/\/github\.com\/agentic\/frontend/u);
  assert.doesNotMatch(workspaceYaml, /\.\/worktrees\/frontend/u);
  assert.deepEqual(config.repos, []);
  assert.equal(config.repositoryDiscovery?.discovery, 'sibling-git-directories');
  assert.match(readFileSync(envPath, 'utf8'), /RAILWAY_TOKEN=\n/u);
});

test('agentic init creates .ewokbot directory and owned subdirectories when needed', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-dir-test-'));
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run(['node', 'agentic', 'init', '--non-interactive']);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'workspace.yml')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', '.env.example')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'runs')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'logs')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'cache')), true);
  assert.equal(existsSync(join(workspaceDir, 'config', 'workspace.yml')), false);
  assert.equal(existsSync(join(workspaceDir, '.env.example')), false);
  assert.equal(existsSync(join(workspaceDir, '.env')), false);
  assert.equal(existsSync(join(workspaceDir, 'runs')), false);
});

test('agentic init refuses to overwrite an existing workspace config', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-overwrite-test-'));
  const configDir = join(workspaceDir, '.ewokbot');
  const targetPath = join(configDir, 'workspace.yml');
  const captured = createCapturedIO();

  mkdirSync(configDir);
  writeFileSync(targetPath, 'workspace: existing\n');

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run(['node', 'agentic', 'init']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Refusing to overwrite existing .+.ewokbot\/workspace\.yml/u);
  assert.equal(readFileSync(targetPath, 'utf8'), 'workspace: existing\n');
});

test('ewokbot init generates Railway-only onboarding config and placeholders', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-railway-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'railway'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.match(readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8'), /deployment_monitors:\n    - railway/u);
  const envExample = readFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'utf8');
  assert.match(envExample, /^RAILWAY_TOKEN=$/mu);
  assert.doesNotMatch(envExample, /^VERCEL_TOKEN=/mu);
  assert.doesNotMatch(envExample, /secret|example-token|changeme/iu);
});

test('ewokbot init generated config uses dev runner env_var_names allowlist', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-env-vars-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'railway'
  ]);

  assert.equal(exitCode, 0);
  const configYaml = readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8');
  const config = parseWorkspaceConfig(configYaml);
  assert.match(configYaml, /env_var_names:\n    - PATH\n    - HOME\n    - TMPDIR\n    - TEMP\n    - TMP/u);
  assert.doesNotMatch(configYaml, /\n  env:\n/u);
  assert.deepEqual(config.devRunner.envVarNames, ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']);
});

test('ewokbot init generates Vercel-only onboarding config and placeholders', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-vercel-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'vercel'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.match(readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8'), /deployment_monitors:\n    - vercel/u);
  const envExample = readFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'utf8');
  assert.match(envExample, /^VERCEL_TOKEN=$/mu);
  assert.doesNotMatch(envExample, /^RAILWAY_TOKEN=/mu);
  assert.doesNotMatch(envExample, /secret|example-token|changeme/iu);
});

test('ewokbot init generates both Railway and Vercel onboarding config', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-both-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initPrompter: async () => ({ deploymentMonitor: 'both', includeOhMyOpenAgent: true })
  }).run(['node', 'ewokbot', 'init']);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  const config = readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8');
  assert.match(config, /deployment_monitors:\n    - railway\n    - vercel/u);
  assert.match(config, /optional_tools:\n    - oh-my-openagent/u);
  const envExample = readFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'utf8');
  assert.match(envExample, /^RAILWAY_TOKEN=$/mu);
  assert.match(envExample, /^VERCEL_TOKEN=$/mu);
});

test('ewokbot init rejects invalid deployment monitor values', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-invalid-monitor-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'vercl'
  ]);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Invalid --deployment-monitor value "vercl"/u);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'workspace.yml')), false);
});

test('ewokbot init rejects missing deployment monitor values', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-missing-monitor-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor'
  ]);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Missing value for --deployment-monitor/u);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'workspace.yml')), false);
});
