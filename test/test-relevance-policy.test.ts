import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateTestRelevance, type AgentCompletionReport, type MeaningfulDiffEvidence, type QualityReport } from '../src/index.js';

test('evaluateTestRelevance passes realistic reported test evidence', () => {
  const report = evaluateTestRelevance({
    meaningfulDiff: meaningfulDiff(),
    agentCompletion: agentCompletion({ testsRun: 'pnpm test' }),
    qualityReport: qualityReport('pnpm test')
  });

  assert.equal(report.decision, 'pass');
  assert.match(report.reason, /Realistic local test evidence/u);
  assert.deepEqual(report.changedFiles, ['src/app.ts']);
  assert.deepEqual(report.testsReported, ['Tests run: pnpm test']);
  assert.equal(report.qualityCommands[0]?.trivial, false);
  assert.equal(report.findings.some((finding) => finding.kind === 'realistic_test_command'), true);
});

test('evaluateTestRelevance warns for stub-only test evidence', () => {
  const report = evaluateTestRelevance({
    meaningfulDiff: meaningfulDiff(),
    agentCompletion: agentCompletion({ testsRun: 'mock test' }),
    qualityReport: qualityReport('mock test')
  });

  assert.equal(report.decision, 'warn');
  assert.match(report.reason, /weak stub-like test evidence/u);
  assert.equal(report.qualityCommands[0]?.trivial, true);
  assert.equal(report.findings.some((finding) => finding.kind === 'trivial_test_command'), true);
});

test('evaluateTestRelevance needs human when tests are explicitly not run', () => {
  const report = evaluateTestRelevance({
    meaningfulDiff: meaningfulDiff(),
    agentCompletion: agentCompletion({ testsRun: 'not run' }),
    qualityReport: qualityReport('pnpm typecheck', 'typecheck')
  });

  assert.equal(report.decision, 'needs_human');
  assert.match(report.reason, /explicitly reported as not run/u);
  assert.equal(report.findings.some((finding) => finding.kind === 'explicit_tests_not_run'), true);
});

test('evaluateTestRelevance needs human when no usable test command passed', () => {
  const report = evaluateTestRelevance({
    meaningfulDiff: meaningfulDiff(),
    agentCompletion: agentCompletion({ testsRun: 'pnpm typecheck' }),
    qualityReport: qualityReport('pnpm typecheck', 'typecheck')
  });

  assert.equal(report.decision, 'needs_human');
  assert.equal(report.findings.some((finding) => finding.kind === 'missing_test_command'), true);
});

test('evaluateTestRelevance passes realistic suffixed package-manager test scripts', () => {
  const commands = [
    'pnpm run test:unit',
    'pnpm test:ci',
    'npm run test:e2e',
    'yarn test:unit',
    'bun run coverage:ci'
  ] as const;

  for (const command of commands) {
    const report = evaluateTestRelevance({
      meaningfulDiff: meaningfulDiff(),
      agentCompletion: agentCompletion({ testsRun: command }),
      qualityReport: qualityReport(command)
    });

    assert.equal(report.decision, 'pass', command);
    assert.equal(report.qualityCommands[0]?.relevant, true, command);
    assert.equal(report.qualityCommands[0]?.trivial, false, command);
    assert.equal(report.findings.some((finding) => finding.kind === 'realistic_test_command'), true, command);
  }
});

function agentCompletion(input: { readonly testsRun: string }): AgentCompletionReport {
  return {
    decision: 'pass',
    reason: 'Agent reported completed work.',
    source: 'implementation_log',
    statusSignal: 'completed',
    summaryText: [
      'Status: completed',
      'Changed files: src/app.ts',
      `Tests run: ${input.testsRun}`,
      'Known limits: none',
      'Blockers: none',
      'Background agents: none'
    ].join('\n'),
    changedFilesMentioned: ['src/app.ts'],
    testsMentioned: true,
    knownLimitsMentioned: true,
    blockers: [],
    findings: []
  };
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

function qualityReport(command: string, name = 'test'): QualityReport {
  return {
    status: 'passed',
    required: [
      {
        name,
        command,
        workingDirectory: '/tmp/app',
        startedAt: '2026-06-07T10:00:00.000Z',
        finishedAt: '2026-06-07T10:00:01.000Z',
        durationMs: 1000,
        exitCode: 0,
        stdoutLogPath: '.ewokbot/runs/AI-101/dev-run-1/quality-logs/test.stdout.log',
        stderrLogPath: '.ewokbot/runs/AI-101/dev-run-1/quality-logs/test.stderr.log',
        status: 'passed',
        summary: 'Quality gate passed.'
      }
    ],
    optional: []
  };
}
