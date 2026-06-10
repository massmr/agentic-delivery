import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateAgentCompletion, type MeaningfulDiffEvidence } from '../src/index.js';

test('evaluateAgentCompletion passes completed implementation summaries with product diff evidence', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: completionLog(),
    meaningfulDiff: meaningfulDiff()
  });

  assert.equal(report.decision, 'pass');
  assert.equal(report.statusSignal, 'completed');
  assert.deepEqual(report.changedFilesMentioned, ['src/app.ts']);
  assert.equal(report.testsMentioned, true);
  assert.equal(report.knownLimitsMentioned, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.findings, []);
});

test('evaluateAgentCompletion fails exploration-only output despite product diff evidence', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: [
      '# Implementation Log',
      '',
      'I looked into the issue and recommend changing src/app.ts later.',
      '',
      '## Required Final Completion Summary',
      'I looked into the issue and recommend changing src/app.ts later.',
      '  Status: completed',
      '- Changed files: src/app.ts',
      '* Tests run: pnpm test',
      '  Known limits: none',
      '- Blockers: none',
      '* Background agents: none',
      ''
    ].join('\n'),
    meaningfulDiff: meaningfulDiff()
  });

  assert.equal(report.decision, 'fail');
  assert.equal(report.findings.some((finding) => finding.kind === 'exploration_only'), true);
});

test('evaluateAgentCompletion fails when background agents are still pending', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: completionLog({ backgroundAgents: 'waiting for background agents bg_123' }),
    meaningfulDiff: meaningfulDiff()
  });

  assert.equal(report.decision, 'fail');
  assert.equal(report.findings.some((finding) => finding.kind === 'pending_background_agents'), true);
});

test('evaluateAgentCompletion fails incomplete and todo-like output', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: completionLog({ status: 'incomplete', body: 'Remaining work: TODO wire tests.' }),
    meaningfulDiff: meaningfulDiff()
  });

  assert.equal(report.decision, 'fail');
  assert.equal(report.findings.some((finding) => finding.kind === 'incomplete_status'), true);
  assert.equal(report.findings.some((finding) => finding.kind === 'incomplete_language'), true);
});

test('evaluateAgentCompletion needs human for explicit credential blocker', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: completionLog({ status: 'blocked', blockers: 'needs operator credentials for Jira access' }),
    meaningfulDiff: meaningfulDiff()
  });

  assert.equal(report.decision, 'needs_human');
  assert.equal(report.findings.some((finding) => finding.kind === 'blocked_status'), true);
  assert.equal(report.findings.some((finding) => finding.kind === 'unresolved_blockers'), true);
});

test('evaluateAgentCompletion fails when no changed product files exist', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: completionLog(),
    meaningfulDiff: meaningfulDiff({ decision: 'failed', productFiles: [], newChangedFiles: [] })
  });

  assert.equal(report.decision, 'fail');
  assert.equal(report.findings.some((finding) => finding.kind === 'diff_not_meaningful'), true);
});

test('evaluateAgentCompletion parses final stdout field block without summary heading', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: [
      '# Implementation Log AD-123',
      '',
      '## Attempt 1',
      '',
      '- Status: PASSED',
      '- Started at: 2026-06-07T10:00:00.000Z',
      '- Finished at: 2026-06-07T10:00:01.000Z',
      '- Summary: Attempt 1 passed.',
      '',
      '### Stdout',
      '```text',
      'Implemented the requested local-only change.',
      '  Status: completed',
      '- Changed files: src/app.ts',
      '* Tests run: pnpm test',
      '  Known limits: none',
      '- Blockers: none',
      '* Background agents: none',
      '```',
      '',
      '### Stderr',
      '```text',
      '```',
      ''
    ].join('\n'),
    meaningfulDiff: meaningfulDiff()
  });

  assert.equal(report.decision, 'pass');
  assert.equal(report.statusSignal, 'completed');
});

test('evaluateAgentCompletion ignores trailing stderr blocks when summary is present', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: [
      '# Implementation Log AD-123',
      '',
      '## Required Final Completion Summary',
      'Implemented the requested local-only change.',
      'Status: completed',
      '- Changed files: src/app.ts',
      '* Tests run: pnpm test',
      '  Known limits: none',
      '- Blockers: none',
      '* Background agents: none',
      '',
      '### Stderr',
      '```text',
      'todo 0',
      '```',
      ''
    ].join('\n'),
    meaningfulDiff: meaningfulDiff()
  });

  assert.equal(report.decision, 'pass');
  assert.equal(report.statusSignal, 'completed');
  assert.equal(report.findings.some((finding) => finding.kind === 'incomplete_language'), false);
});

test('evaluateAgentCompletion does not treat attempt metadata status as completion', () => {
  const report = evaluateAgentCompletion({
    implementationLogText: [
      '# Implementation Log AD-123',
      '',
      '## Attempt 1',
      '',
      '- Status: PASSED',
      '- Summary: Attempt 1 passed.',
      '',
      '### Stdout',
      '```text',
      'OpenCode exited successfully but did not print completion fields.',
      '```',
      ''
    ].join('\n'),
    meaningfulDiff: meaningfulDiff()
  });

  assert.equal(report.decision, 'fail');
  assert.equal(report.statusSignal, 'missing');
  assert.equal(report.findings.some((finding) => finding.kind === 'missing_completed_status'), true);
});

function completionLog(input: {
  readonly status?: 'completed' | 'blocked' | 'incomplete' | undefined;
  readonly body?: string | undefined;
  readonly changedFiles?: string | undefined;
  readonly testsRun?: string | undefined;
  readonly knownLimits?: string | undefined;
  readonly blockers?: string | undefined;
  readonly backgroundAgents?: string | undefined;
} = {}): string {
  return [
    '# Implementation Log',
    '',
    '## Required Final Completion Summary',
    input.body ?? 'Implemented the requested local-only change.',
    `Status: ${input.status ?? 'completed'}`,
    `Changed files: ${input.changedFiles ?? 'src/app.ts'}`,
    `Tests run: ${input.testsRun ?? 'pnpm test'}`,
    `Known limits: ${input.knownLimits ?? 'none'}`,
    `Blockers: ${input.blockers ?? 'none'}`,
    `Background agents: ${input.backgroundAgents ?? 'none'}`,
    ''
  ].join('\n');
}

function meaningfulDiff(overrides: Partial<MeaningfulDiffEvidence> = {}): MeaningfulDiffEvidence {
  return {
    decision: 'passed',
    reason: 'Meaningful product diff detected.',
    baselineChangedFiles: [],
    afterAgentChangedFiles: ['src/app.ts'],
    newChangedFiles: ['src/app.ts'],
    changedFiles: ['src/app.ts'],
    productFiles: ['src/app.ts'],
    ignoredFiles: [],
    ignoredPathPatterns: [],
    baselineDiffSummary: '',
    afterAgentDiffSummary: ' src/app.ts | 1 +',
    diffSummary: ' src/app.ts | 1 +',
    ...overrides
  };
}
