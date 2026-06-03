import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { createCliProgram, getRunStateFilePath, type DeliveryRunStateRecord } from '../src/index.js';

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-cli-quality-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

test('agentic quality writes report, logs, and passed state for a local repository', async (t) => {
  const workspacePath = await createTempRoot(t);
  const repositoryPath = join(workspacePath, 'repo');
  const captured = createCapturedIO();

  await mkdir(repositoryPath);
  await writeFile(
    join(repositoryPath, '.agent-quality.yml'),
    [
      'commands:',
      `  test: ${process.execPath} -e "console.log('quality-ok')"`,
      'required:',
      '  - test',
      'optional:',
      '  - lint',
      ''
    ].join('\n')
  );

  const exitCode = await createCliProgram({ cwd: workspacePath, io: captured.io }).run([
    'node',
    'agentic',
    'quality',
    repositoryPath,
    '--ticket-key',
    'AD-123',
    '--run-id',
    'run-1'
  ]);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Quality passed for AD-123 as run-1/u);
  assert.match(captured.stdout, /Report: runs\/AD-123\/run-1\/quality-report\.md/u);
  assert.equal(captured.stderr, '');

  const reportPath = join(workspacePath, 'runs', 'AD-123', 'run-1', 'quality-report.md');
  const statePath = join(workspacePath, getRunStateFilePath('AD-123', 'run-1'));
  const stdoutLogPath = join(workspacePath, 'runs', 'AD-123', 'run-1', 'quality-logs', 'test.stdout.log');
  const optionalStderrLogPath = join(workspacePath, 'runs', 'AD-123', 'run-1', 'quality-logs', 'lint.stderr.log');

  assert.equal((await stat(reportPath)).isFile(), true);
  assert.match(await readFile(reportPath, 'utf8'), /lint: SKIPPED/u);
  assert.match(await readFile(stdoutLogPath, 'utf8'), /quality-ok/u);
  assert.match(await readFile(optionalStderrLogPath, 'utf8'), /optional gate has no command/u);

  const state = JSON.parse(await readFile(statePath, 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'LOCAL_CHECKS_PASSED');
  assert.equal(state.ticket.key, 'AD-123');
  assert.equal(state.qualityReports.length, 1);
  assert.equal(state.qualityReports[0]?.status, 'passed');
});

test('agentic quality exits non-zero and stops on required failure', async (t) => {
  const workspacePath = await createTempRoot(t);
  const repositoryPath = join(workspacePath, 'repo');
  const captured = createCapturedIO();

  await mkdir(repositoryPath);
  await writeFile(
    join(repositoryPath, '.agent-quality.yml'),
    [
      'commands:',
      `  test: ${process.execPath} -e "process.exit(3)"`,
      `  build: ${process.execPath} -e "console.log('should-not-run')"`,
      'required:',
      '  - test',
      '  - build',
      ''
    ].join('\n')
  );

  const exitCode = await createCliProgram({ cwd: workspacePath, io: captured.io }).run([
    'node',
    'agentic',
    'quality',
    repositoryPath,
    '--ticket-key',
    'AD-456',
    '--run-id',
    'run-2'
  ]);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Quality failed for AD-456 as run-2/u);
  assert.match(captured.stderr, /Report: runs\/AD-456\/run-2\/quality-report\.md/u);

  const buildStdoutPath = join(workspacePath, 'runs', 'AD-456', 'run-2', 'quality-logs', 'build.stdout.log');
  const statePath = join(workspacePath, getRunStateFilePath('AD-456', 'run-2'));
  const state = JSON.parse(await readFile(statePath, 'utf8')) as DeliveryRunStateRecord;

  await assert.rejects(stat(buildStdoutPath));
  assert.equal(state.state, 'FAILED');
  assert.match(state.failure?.reason ?? '', /test failed with exit code 3/u);
  assert.equal(state.qualityReports[0]?.required.length, 1);
  assert.equal(state.qualityReports[0]?.required[0]?.status, 'failed');
});

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
