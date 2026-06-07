import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { captureDiffAdditions, evaluateCoreSafety, parseDiffAdditions, type CoreSafetyDiffAddition } from '../src/index.js';

test('evaluateCoreSafety passes a small safe product diff', () => {
  const report = evaluateCoreSafety({
    changedFiles: ['src/app.ts'],
    additions: [addition('src/app.ts', 10, 'export const safe = true;')]
  });

  assert.equal(report.decision, 'pass');
  assert.equal(report.changedFileCount, 1);
  assert.equal(report.addedLineCount, 1);
  assert.deepEqual(report.forbiddenFiles, []);
  assert.deepEqual(report.secretFindings, []);
  assert.deepEqual(report.humanReviewFindings, []);
});

test('evaluateCoreSafety fails forbidden environment and key files', () => {
  const report = evaluateCoreSafety({
    changedFiles: ['.env.local', 'config/private.pem', '.ewokbot/workspace.yml'],
    additions: []
  });

  assert.equal(report.decision, 'fail');
  assert.deepEqual(report.forbiddenFiles.map((finding) => finding.filePath), ['.env.local', 'config/private.pem', '.ewokbot/workspace.yml']);
});

test('evaluateCoreSafety fails secret-like additions without storing raw values', () => {
  const rawSecret = 'sk-live-1234567890abcdef';
  const report = evaluateCoreSafety({
    changedFiles: ['src/config.ts'],
    additions: [addition('src/config.ts', 4, `const apiKey = "${rawSecret}";`)]
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.decision, 'fail');
  assert.equal(report.secretFindings.length, 1);
  assert.equal(report.secretFindings[0]?.detector, 'secret_assignment');
  assert.doesNotMatch(serialized, new RegExp(rawSecret, 'u'));
});

test('evaluateCoreSafety needs human when test-overridden limits are exceeded', () => {
  const report = evaluateCoreSafety({
    changedFiles: ['src/a.ts', 'src/b.ts'],
    additions: [addition('src/a.ts', 1, 'a'), addition('src/b.ts', 1, 'b')],
    limits: {
      maxChangedFiles: 1,
      maxAddedLines: 1
    }
  });

  assert.equal(report.decision, 'needs_human');
  assert.deepEqual(report.limitFindings.map((finding) => finding.limit), ['maxChangedFiles', 'maxAddedLines']);
});

test('evaluateCoreSafety needs human for sensitive review categories', () => {
  const report = evaluateCoreSafety({
    changedFiles: ['pnpm-lock.yaml', 'db/migrations/001_add_table.sql', 'src/auth/session.ts', 'src/payments/stripe.ts', '.github/workflows/deploy.yml'],
    additions: []
  });

  assert.equal(report.decision, 'needs_human');
  assert.deepEqual(
    report.humanReviewFindings.map((finding) => finding.category),
    ['dependency_lockfile', 'db_migration', 'auth_path', 'payment_billing_path', 'infra_deployment_config']
  );
});

test('parseDiffAdditions extracts added lines and line numbers from unified diff', () => {
  const additions = parseDiffAdditions([
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,0 +2,2 @@',
    '+const first = 1;',
    '+const second = 2;',
    ''
  ].join('\n'));

  assert.deepEqual(additions, [
    { filePath: 'src/app.ts', lineNumber: 2, content: 'const first = 1;' },
    { filePath: 'src/app.ts', lineNumber: 3, content: 'const second = 2;' }
  ]);
});

test('captureDiffAdditions uses HEAD diff for tracked files and local reads for untracked files', async () => {
  const calls: string[] = [];

  const additions = await captureDiffAdditions({
    repositoryPath: '/repo',
    changedFiles: ['src/tracked.ts', 'src/new-file.ts'],
    gitCommandRunner: async (input) => {
      calls.push(input.args[0] ?? 'unknown');

      if (input.args[0] === 'status') {
        return { stdout: ' M src/tracked.ts\n?? src/new-file.ts\n', stderr: '', exitCode: 0 };
      }

      if (input.args[0] === 'diff') {
        assert.deepEqual(input.args, ['diff', '--unified=0', '--no-ext-diff', 'HEAD', '--', 'src/tracked.ts']);
        return {
          stdout: [
            'diff --git a/src/tracked.ts b/src/tracked.ts',
            '--- a/src/tracked.ts',
            '+++ b/src/tracked.ts',
            '@@ -1,0 +1,2 @@',
            '+const tracked = 1;',
            '+const trackedNext = 2;',
            ''
          ].join('\n'),
          stderr: '',
          exitCode: 0
        };
      }

      throw new Error(`Unexpected git command: ${input.args.join(' ')}`);
    },
    readFile: async (path) => {
      calls.push(`readFile:${path}`);
      assert.equal(path, '/repo/src/new-file.ts');
      return ['const untracked = 3;', 'const untrackedNext = 4;', ''].join('\n');
    }
  });

  assert.deepEqual(additions, [
    { filePath: 'src/tracked.ts', lineNumber: 1, content: 'const tracked = 1;' },
    { filePath: 'src/tracked.ts', lineNumber: 2, content: 'const trackedNext = 2;' },
    { filePath: 'src/new-file.ts', lineNumber: 1, content: 'const untracked = 3;' },
    { filePath: 'src/new-file.ts', lineNumber: 2, content: 'const untrackedNext = 4;' }
  ]);
  assert.deepEqual(calls, ['status', 'diff', 'readFile:/repo/src/new-file.ts']);
});

function addition(filePath: string, lineNumber: number, content: string): CoreSafetyDiffAddition {
  return { filePath, lineNumber, content };
}
