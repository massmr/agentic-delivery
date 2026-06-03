import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('agentic init copies the bundled example config in the current directory', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-test-'));
  const cliPath = resolve('dist/src/cli/index.js');
  const result = spawnSync(process.execPath, [cliPath, 'init'], {
    cwd: workspaceDir,
    encoding: 'utf8'
  });

  const targetPath = join(workspaceDir, 'config', 'workspace.yml');

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Created .+config\/workspace\.yml/u);
  assert.equal(readFileSync(targetPath, 'utf8'), readFileSync(resolve('config/workspace.example.yml'), 'utf8'));
});

test('agentic init creates config directory when needed', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-dir-test-'));
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run(['node', 'agentic', 'init']);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(join(workspaceDir, 'config', 'workspace.yml')), true);
});

test('agentic init refuses to overwrite an existing workspace config', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-overwrite-test-'));
  const configDir = join(workspaceDir, 'config');
  const targetPath = join(configDir, 'workspace.yml');
  const captured = createCapturedIO();

  mkdirSync(configDir);
  writeFileSync(targetPath, 'workspace: existing\n');

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io }).run(['node', 'agentic', 'init']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Refusing to overwrite existing .+config\/workspace\.yml/u);
  assert.equal(readFileSync(targetPath, 'utf8'), 'workspace: existing\n');
});
