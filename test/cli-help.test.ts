import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
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
  assert.match(result.stdout, /agentic status <ticket-key>/u);
  assert.match(result.stdout, /agentic quality <repo-path> --ticket-key <ticket-key>/u);
  assert.match(result.stdout, /Mock mode only/u);
});
