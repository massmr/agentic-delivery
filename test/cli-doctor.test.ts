import * as assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('ewokbot doctor reports missing local setup without live calls', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-doctor-missing-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run(['node', 'ewokbot', 'doctor']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stderr, '');
  assert.match(captured.stdout, /Doctor checked local files only/u);
  assert.match(captured.stdout, /Missing .ewokbot\/workspace\.yml/u);
  assert.match(captured.stdout, /Run ewokbot init/u);
});

test('ewokbot doctor validates generated local setup without provider calls', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-doctor-generated-'));
  const capturedInit = createCapturedIO();
  const initExitCode = await createCliProgram({ cwd: workspaceDir, io: capturedInit.io }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'both'
  ]);

  assert.equal(initExitCode, 0);

  const capturedDoctor = createCapturedIO();
  const doctorExitCode = await createCliProgram({
    cwd: workspaceDir,
    io: capturedDoctor.io,
    doctorOptions: {
      nodeVersion: 'v20.11.1',
      commandExists: (command) => command === 'pnpm' || command === 'opencode'
    }
  }).run(['node', 'ewokbot', 'doctor']);

  assert.equal(doctorExitCode, 0);
  assert.equal(capturedDoctor.stderr, '');
  assert.match(capturedDoctor.stdout, /Doctor checked local files only/u);
  assert.match(capturedDoctor.stdout, /.ewokbot\/workspace\.yml is valid/u);
  assert.match(capturedDoctor.stdout, /Deployment monitors: railway, vercel/u);
  assert.match(capturedDoctor.stdout, /PASS: Node\.js/u);
  assert.match(capturedDoctor.stdout, /PASS: pnpm/u);
  assert.match(capturedDoctor.stdout, /WARN: \.ewokbot\/\.env/u);
});

test('ewokbot doctor renders failures and never prints secret values', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-doctor-cli-redaction-'));
  const capturedInit = createCapturedIO();
  const initExitCode = await createCliProgram({ cwd: workspaceDir, io: capturedInit.io }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'railway'
  ]);

  assert.equal(initExitCode, 0);
  writeFileSync(join(workspaceDir, '.ewokbot', '.env'), 'GITHUB_TOKEN=super-secret-token\n', 'utf8');

  const captured = createCapturedIO();
  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    doctorOptions: {
      env: { GITHUB_TOKEN: 'super-secret-process-token' },
      nodeVersion: 'v18.19.0',
      commandExists: () => false
    }
  }).run(['node', 'ewokbot', 'doctor']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /FAIL: Node\.js/u);
  assert.match(captured.stdout, /FAIL: pnpm/u);
  assert.match(captured.stdout, /FAIL: OpenCode/u);
  assert.doesNotMatch(captured.stdout, /super-secret/u);
  assert.match(captured.stdout, /\[redacted\]/u);
});

test('ewokbot doctor reports missing env placeholders for generated config', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-doctor-env-'));
  const capturedInit = createCapturedIO();
  const initExitCode = await createCliProgram({ cwd: workspaceDir, io: capturedInit.io }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'vercel'
  ]);

  assert.equal(initExitCode, 0);
  writeFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'GITHUB_TOKEN=\n', 'utf8');
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run(['node', 'ewokbot', 'doctor']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Missing \.ewokbot\/\.env\.example placeholder: VERCEL_TOKEN/u);
});
