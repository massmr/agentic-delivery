import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  inspectMeaningfulDiff,
  isIgnoredMeaningfulDiffPath,
  type MeaningfulDiffSnapshot,
  parsePorcelainStatus,
  type GitCommandInput,
  type GitCommandResult
} from '../src/index.js';

test('parsePorcelainStatus extracts unique changed paths from git porcelain output', () => {
  assert.deepEqual(
    parsePorcelainStatus([' M src/app.ts', '?? .omo/session.json', 'R  old-name.ts -> src/new-name.ts', ' M src/app.ts', ''].join('\n')),
    ['src/app.ts', '.omo/session.json', 'src/new-name.ts']
  );
});

test('isIgnoredMeaningfulDiffPath deterministically ignores agent artifacts, logs, and caches', () => {
  assert.equal(isIgnoredMeaningfulDiffPath('.omo/session.json'), true);
  assert.equal(isIgnoredMeaningfulDiffPath('.ewokbot/runs/AI-101/run-1/evidence.json'), true);
  assert.equal(isIgnoredMeaningfulDiffPath('logs/opencode.log'), true);
  assert.equal(isIgnoredMeaningfulDiffPath('src/cache/generated.json'), true);
  assert.equal(isIgnoredMeaningfulDiffPath('src/app.ts'), false);
});

test('inspectMeaningfulDiff fails when all changes are ignored artifacts', async () => {
  const evidence = await inspectMeaningfulDiff({
    repositoryPath: '/repo',
    gitCommandRunner: createDiffGitRunner({
      status: ['?? .omo/session.json', '?? .ewokbot/runs/AI-101/run-1/evidence.json', '?? logs/opencode.log', ''].join('\n'),
      diff: ''
    })
  });

  assert.equal(evidence.decision, 'failed');
  assert.deepEqual(evidence.baselineChangedFiles, []);
  assert.deepEqual(evidence.afterAgentChangedFiles, ['.omo/session.json', '.ewokbot/runs/AI-101/run-1/evidence.json', 'logs/opencode.log']);
  assert.deepEqual(evidence.newChangedFiles, ['.omo/session.json', '.ewokbot/runs/AI-101/run-1/evidence.json', 'logs/opencode.log']);
  assert.deepEqual(evidence.productFiles, []);
  assert.deepEqual(evidence.ignoredFiles, ['.omo/session.json', '.ewokbot/runs/AI-101/run-1/evidence.json', 'logs/opencode.log']);
  assert.match(evidence.reason, /no product file changes/u);
});

test('inspectMeaningfulDiff passes when product files changed', async () => {
  const evidence = await inspectMeaningfulDiff({
    repositoryPath: '/repo',
    gitCommandRunner: createDiffGitRunner({
      status: [' M src/app.ts', '?? .omo/session.json', ''].join('\n'),
      diff: ' src/app.ts | 1 +'
    })
  });

  assert.equal(evidence.decision, 'passed');
  assert.deepEqual(evidence.baselineChangedFiles, []);
  assert.deepEqual(evidence.afterAgentChangedFiles, ['src/app.ts', '.omo/session.json']);
  assert.deepEqual(evidence.newChangedFiles, ['src/app.ts', '.omo/session.json']);
  assert.deepEqual(evidence.productFiles, ['src/app.ts']);
  assert.deepEqual(evidence.ignoredFiles, ['.omo/session.json']);
  assert.equal(evidence.diffSummary, 'src/app.ts | 1 +');
});

test('inspectMeaningfulDiff fails when only pre-existing product changes remain after OpenCode', async () => {
  const baseline: MeaningfulDiffSnapshot = {
    changedFiles: ['src/preexisting.ts'],
    diffSummary: ' src/preexisting.ts | 1 +'
  };

  const evidence = await inspectMeaningfulDiff({
    repositoryPath: '/repo',
    baseline,
    gitCommandRunner: createDiffGitRunner({
      status: [' M src/preexisting.ts', ''].join('\n'),
      diff: ' src/preexisting.ts | 1 +'
    })
  });

  assert.equal(evidence.decision, 'failed');
  assert.deepEqual(evidence.baselineChangedFiles, ['src/preexisting.ts']);
  assert.deepEqual(evidence.afterAgentChangedFiles, ['src/preexisting.ts']);
  assert.deepEqual(evidence.newChangedFiles, []);
  assert.deepEqual(evidence.productFiles, []);
  assert.match(evidence.reason, /no new changed files after the pre-OpenCode baseline/u);
});

test('inspectMeaningfulDiff passes only agent-introduced product files when baseline has ignored artifacts', async () => {
  const baseline: MeaningfulDiffSnapshot = {
    changedFiles: ['.omo/session.json'],
    diffSummary: ''
  };

  const evidence = await inspectMeaningfulDiff({
    repositoryPath: '/repo',
    baseline,
    gitCommandRunner: createDiffGitRunner({
      status: ['?? .omo/session.json', ' M src/app.ts', ''].join('\n'),
      diff: ' src/app.ts | 1 +'
    })
  });

  assert.equal(evidence.decision, 'passed');
  assert.deepEqual(evidence.baselineChangedFiles, ['.omo/session.json']);
  assert.deepEqual(evidence.afterAgentChangedFiles, ['.omo/session.json', 'src/app.ts']);
  assert.deepEqual(evidence.newChangedFiles, ['src/app.ts']);
  assert.deepEqual(evidence.productFiles, ['src/app.ts']);
  assert.deepEqual(evidence.ignoredFiles, []);
});

function createDiffGitRunner(output: { readonly status: string; readonly diff: string }): (input: GitCommandInput) => Promise<GitCommandResult> {
  return async (input) => {
    if (input.args[0] === 'status') {
      return { stdout: output.status, stderr: '', exitCode: 0 };
    }

    if (input.args[0] === 'diff') {
      return { stdout: output.diff, stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: `unexpected git command: ${input.args.join(' ')}`, exitCode: 1 };
  };
}
