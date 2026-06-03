import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MarkdownReportWriter,
  QualityRunner,
  buildQualityGateDefinitions,
  detectNodeQualityConfig,
  parseRepositoryQualityConfig,
  renderQualityReportMarkdown,
  type QualityReport
} from '../src/index.js';

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-quality-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

test('parseRepositoryQualityConfig parses command, required, and optional gates', () => {
  const config = parseRepositoryQualityConfig([
    'commands:',
    '  lint: npm run lint',
    '  test: npm test',
    'required:',
    '  - lint',
    'optional:',
    '  - test',
    ''
  ].join('\n'));

  assert.deepEqual(config, {
    commands: {
      lint: 'npm run lint',
      test: 'npm test'
    },
    required: ['lint'],
    optional: ['test']
  });
});

test('buildQualityGateDefinitions fails when a required gate has no command', () => {
  assert.throws(
    () => buildQualityGateDefinitions({ commands: {}, required: ['lint'], optional: [] }, '/repo'),
    /Quality gate 'lint' is listed as required but has no command/u
  );
});

test('buildQualityGateDefinitions skips optional gates without commands as warnings', () => {
  const gates = buildQualityGateDefinitions({ commands: { test: 'npm test' }, required: ['test'], optional: ['lint'] }, '/repo');

  assert.deepEqual(gates, [
    {
      name: 'test',
      command: 'npm test',
      requirement: 'required',
      workingDirectory: '/repo'
    },
    {
      name: 'lint',
      requirement: 'optional',
      workingDirectory: '/repo'
    }
  ]);
});

test('detectNodeQualityConfig detects npm scripts and install command', async (t) => {
  const rootPath = await createTempRoot(t);

  await writeFile(
    join(rootPath, 'package.json'),
    JSON.stringify({
      scripts: {
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        test: 'node --test',
        build: 'tsc'
      }
    })
  );
  await writeFile(join(rootPath, 'package-lock.json'), '{}\n');

  const config = await detectNodeQualityConfig(rootPath);

  assert.equal(config.commands.install, 'npm ci');
  assert.equal(config.commands.lint, 'npm run lint');
  assert.equal(config.commands.test, 'npm test');
  assert.deepEqual(config.required, ['install', 'lint', 'typecheck', 'test', 'build']);
});

test('QualityRunner runs gates in order and stops on required failure', async (t) => {
  const rootPath = await createTempRoot(t);
  const report = await new QualityRunner({ logRootPath: join(rootPath, 'logs') }).run([
    {
      name: 'test',
      command: `${process.execPath} -e "console.log('ok')"`,
      requirement: 'required',
      workingDirectory: rootPath
    },
    {
      name: 'build',
      command: `${process.execPath} -e "process.exit(2)"`,
      requirement: 'required',
      workingDirectory: rootPath
    },
    {
      name: 'lint',
      command: `${process.execPath} -e "console.log('should not run')"`,
      requirement: 'required',
      workingDirectory: rootPath
    }
  ]);

  assert.equal(report.status, 'failed');
  assert.equal(report.required.length, 2);
  assert.equal(report.required[0]?.status, 'passed');
  assert.equal(report.required[1]?.status, 'failed');
  assert.match(await readFile(join(rootPath, 'logs', 'test.stdout.log'), 'utf8'), /ok/u);
});

test('QualityRunner records optional gates without commands as skipped warnings', async (t) => {
  const rootPath = await createTempRoot(t);
  const report = await new QualityRunner({ logRootPath: join(rootPath, 'logs') }).run([
    {
      name: 'test',
      command: `${process.execPath} -e "console.log('ok')"`,
      requirement: 'required',
      workingDirectory: rootPath
    },
    {
      name: 'lint',
      requirement: 'optional',
      workingDirectory: rootPath
    }
  ]);

  assert.equal(report.status, 'passed');
  assert.equal(report.optional[0]?.status, 'skipped');
  assert.equal(report.optional[0]?.exitCode, null);
  assert.match(report.optional[0]?.summary ?? '', /optional gate has no command/u);
  assert.match(await readFile(join(rootPath, 'logs', 'lint.stderr.log'), 'utf8'), /skipped/u);
});

test('MarkdownReportWriter writes deterministic quality reports to the run directory', async (t) => {
  const rootPath = await createTempRoot(t);
  const report = createSampleQualityReport(rootPath);
  const relativePath = await new MarkdownReportWriter(rootPath).writeQuality('AD-123', 'run-1', report);

  assert.equal(relativePath, 'runs/AD-123/run-1/quality-report.md');
  assert.equal((await stat(join(rootPath, relativePath))).isFile(), true);

  const markdown = await readFile(join(rootPath, relativePath), 'utf8');
  assert.equal(markdown, renderQualityReportMarkdown('AD-123', 'run-1', report));
  assert.match(markdown, /# Quality Report AD-123/u);
  assert.match(markdown, /Status: PASSED/u);
  assert.match(markdown, /lint: SKIPPED/u);
  assert.match(markdown, /optional gate has no command/u);
});

function createSampleQualityReport(rootPath: string): QualityReport {
  return {
    status: 'passed',
    required: [
      {
        name: 'test',
        command: 'npm test',
        workingDirectory: rootPath,
        startedAt: '2026-06-03T10:00:00.000Z',
        finishedAt: '2026-06-03T10:00:01.000Z',
        durationMs: 1000,
        exitCode: 0,
        stdoutLogPath: join(rootPath, 'logs', 'test.stdout.log'),
        stderrLogPath: join(rootPath, 'logs', 'test.stderr.log'),
        status: 'passed',
        summary: 'test passed.'
      }
    ],
    optional: [
      {
        name: 'lint',
        workingDirectory: rootPath,
        startedAt: '2026-06-03T10:00:01.000Z',
        finishedAt: '2026-06-03T10:00:01.000Z',
        durationMs: 0,
        exitCode: null,
        stdoutLogPath: join(rootPath, 'logs', 'lint.stdout.log'),
        stderrLogPath: join(rootPath, 'logs', 'lint.stderr.log'),
        status: 'skipped',
        summary: 'lint skipped: optional gate has no command configured.'
      }
    ]
  };
}
