import * as assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createOnboardingFiles, runLocalDoctor } from '../../src/index.js';

async function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function writeGeneratedSetup(cwd: string, monitor: 'railway' | 'vercel' | 'both' = 'both'): void {
  const files = createOnboardingFiles({ deploymentMonitor: monitor, includeOhMyOpenAgent: false });
  mkdirSync(join(cwd, 'config'), { recursive: true });
  writeFileSync(join(cwd, 'config', 'workspace.yml'), files.workspaceYaml, 'utf8');
  writeFileSync(join(cwd, '.env.example'), files.envExample, 'utf8');
}

test('doctor reports generated setup with injected local probes and warn-only mock readiness', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-generated-');
  writeGeneratedSetup(cwd, 'both');

  const report = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode'
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'Node.js'), true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'pnpm'), true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'OpenCode'), true);
  assert.equal(report.checks.some((check) => check.status === 'warn' && check.label === '.env'), true);
  assert.equal(report.checks.some((check) => check.status === 'warn' && check.label === 'Repository frontend'), true);
  assert.equal(report.checks.some((check) => check.status === 'fail'), false);
});

test('doctor redacts env values while reporting provider readiness', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-redaction-');
  writeGeneratedSetup(cwd, 'railway');
  writeFileSync(
    join(cwd, '.env'),
    [
      'GITHUB_ORG=secret-org',
      'GITHUB_TOKEN=ghp_secret_value',
      'JIRA_BASE_URL=https://secret-jira.example.test',
      'JIRA_EMAIL=secret@example.test',
      'JIRA_API_TOKEN=jira_secret_value',
      'RAILWAY_TOKEN=railway_secret_value'
    ].join('\n'),
    'utf8'
  );

  const report = runLocalDoctor(cwd, {
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode'
  });
  const rendered = JSON.stringify(report);

  assert.equal(report.checks.some((check) => check.label === 'GitHub' && check.status === 'pass'), true);
  assert.equal(report.checks.some((check) => check.label === 'Jira' && check.status === 'pass'), true);
  assert.equal(report.checks.some((check) => check.label === 'Railway' && check.status === 'pass'), true);
  assert.doesNotMatch(rendered, /ghp_secret_value|jira_secret_value|railway_secret_value|secret-org|secret@example/u);
  assert.match(rendered, /\[redacted\]/u);
});

test('doctor fails missing provider secrets when provider mode is non-mock', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-real-mode-');
  writeGeneratedSetup(cwd, 'railway');
  const configPath = join(cwd, 'config', 'workspace.yml');
  const source = createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false }).workspaceYaml
    .replace('github:\n  mode: mock', 'github:\n  mode: real');
  writeFileSync(configPath, source, 'utf8');

  const report = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode'
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.status === 'fail' && check.label === 'GitHub' && /GITHUB_TOKEN/u.test(check.message)), true);
});

test('doctor validates repository branch and quality readiness statically', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-repo-');
  const repoPath = join(cwd, 'worktrees', 'frontend');
  mkdirSync(repoPath, { recursive: true });
  writeGeneratedSetup(cwd, 'vercel');
  writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }), 'utf8');

  const report = runLocalDoctor(cwd, {
    env: {
      GITHUB_ORG: 'agentic',
      GITHUB_TOKEN: 'present',
      JIRA_BASE_URL: 'https://jira.example.test',
      JIRA_EMAIL: 'bot@example.test',
      JIRA_API_TOKEN: 'present',
      VERCEL_TOKEN: 'present'
    },
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode'
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'Repository frontend'), true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'Quality frontend'), true);
  assert.equal(report.checks.some((check) => check.label === 'Branch policy' && check.status === 'fail'), false);
});

test('doctor fails unsafe branch settings and invalid quality config', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-unsafe-');
  const repoPath = join(cwd, 'worktrees', 'frontend');
  mkdirSync(repoPath, { recursive: true });
  const source = createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false }).workspaceYaml
    .replace('staging_branch: develop', 'staging_branch: main')
    .replace('default_branch: develop', 'default_branch: main');
  mkdirSync(join(cwd, 'config'), { recursive: true });
  writeFileSync(join(cwd, 'config', 'workspace.yml'), source, 'utf8');
  writeFileSync(join(cwd, '.env.example'), createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false }).envExample, 'utf8');
  writeFileSync(join(repoPath, '.agent-quality.yml'), 'commands: []\nrequired: test\n', 'utf8');

  const report = runLocalDoctor(cwd, {
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode'
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.label === 'Branch policy' && check.status === 'fail'), true);
  assert.equal(report.checks.some((check) => check.label === 'Quality frontend' && check.status === 'fail'), true);
});
