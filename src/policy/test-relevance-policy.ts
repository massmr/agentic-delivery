import type {
  AgentCompletionReport,
  MeaningfulDiffEvidence,
  QualityGateDefinition,
  QualityGateResult,
  QualityReport,
  TestRelevanceFinding,
  TestRelevanceQualityCommand,
  TestRelevanceReport
} from '../domain/index.js';

export interface EvaluateTestRelevanceInput {
  readonly meaningfulDiff?: MeaningfulDiffEvidence | undefined;
  readonly agentCompletion?: AgentCompletionReport | undefined;
  readonly qualityReport: QualityReport;
  readonly qualityGates?: readonly QualityGateDefinition[] | undefined;
}

const realisticTestCommandPatterns = [
  /^pnpm\s+(?:run\s+)?(?:test|tests|e2e|coverage)(?::[a-z0-9._-]+)*(?:\s|$)/u,
  /^npm\s+(?:run\s+)?(?:test|tests|e2e|coverage)(?::[a-z0-9._-]+)*(?:\s|$)/u,
  /^yarn\s+(?:run\s+)?(?:test|tests|e2e|coverage)(?::[a-z0-9._-]+)*(?:\s|$)/u,
  /^bun\s+(?:run\s+)?(?:test|tests|e2e|coverage)(?::[a-z0-9._-]+)*(?:\s|$)/u,
  /^node\s+--test(?:\s|$)/u,
  /(?:^|\s)vitest(?:\s|$)/u,
  /(?:^|\s)jest(?:\s|$)/u,
  /^playwright\s+test(?:\s|$)/u
] as const;

export const trivialTestCommandPatterns = [
  'mock test',
  'true',
  ':',
  'echo <text>',
  'node -e console.log/process.exit(0)',
  'node -p <expression>'
] as const;

export function evaluateTestRelevance(input: EvaluateTestRelevanceInput): TestRelevanceReport {
  const changedFiles = selectChangedFiles(input.meaningfulDiff);
  const testsReported = extractTestsReported(input.agentCompletion);
  const qualityCommands = collectQualityCommands(input.qualityReport);
  const findings: TestRelevanceFinding[] = [];

  if (changedFiles.length === 0) {
    findings.push({
      kind: 'non_product_change',
      severity: 'info',
      message: 'No product file changes were present in meaningful-diff evidence.'
    });

    return {
      decision: 'pass',
      reason: 'No product file changes required test relevance evidence.',
      changedFiles,
      testsReported,
      qualityCommands,
      findings,
      trivialCommandPatterns: trivialTestCommandPatterns
    };
  }

  if (hasExplicitNoTests(input.agentCompletion)) {
    findings.push({
      kind: 'explicit_tests_not_run',
      severity: 'needs_human',
      message: 'Agent completion evidence explicitly says tests were not run.'
    });

    return buildReport('needs_human', 'Tests were explicitly reported as not run for product changes.', changedFiles, testsReported, qualityCommands, findings);
  }

  if (testsReported.length === 0) {
    findings.push({
      kind: 'missing_test_claim',
      severity: 'needs_human',
      message: 'Agent completion evidence did not include a usable tests-run claim.'
    });
  }

  const relevantPassedCommands = qualityCommands.filter((command) => command.relevant && command.status === 'passed');
  const realisticPassedCommands = relevantPassedCommands.filter((command) => !command.trivial && isRealisticTestCommand(command.command));
  const trivialPassedCommands = relevantPassedCommands.filter((command) => command.trivial);

  if (realisticPassedCommands.length > 0 && testsReported.length > 0) {
    findings.push({
      kind: 'realistic_test_command',
      severity: 'info',
      message: `Realistic test command evidence found: ${realisticPassedCommands.map((command) => command.command).join(', ')}.`
    });

    return buildReport('pass', 'Realistic local test evidence was reported and passed for product changes.', changedFiles, testsReported, qualityCommands, findings);
  }

  if (trivialPassedCommands.length > 0) {
    findings.push({
      kind: 'trivial_test_command',
      severity: 'warn',
      message: `Only trivial or stub-like test command evidence was found: ${trivialPassedCommands.map((command) => command.command).join(', ')}.`
    });

    return buildReport('warn', 'Only weak stub-like test evidence was available for product changes.', changedFiles, testsReported, qualityCommands, findings);
  }

  findings.push({
    kind: 'missing_test_command',
    severity: 'needs_human',
    message: 'No passed test, e2e, or coverage quality command was available for product changes.'
  });

  return buildReport('needs_human', 'No usable local test evidence was available for product changes.', changedFiles, testsReported, qualityCommands, findings);
}

function buildReport(
  decision: TestRelevanceReport['decision'],
  reason: string,
  changedFiles: readonly string[],
  testsReported: readonly string[],
  qualityCommands: readonly TestRelevanceQualityCommand[],
  findings: readonly TestRelevanceFinding[]
): TestRelevanceReport {
  return {
    decision,
    reason,
    changedFiles,
    testsReported,
    qualityCommands,
    findings,
    trivialCommandPatterns: trivialTestCommandPatterns
  };
}

function selectChangedFiles(meaningfulDiff: MeaningfulDiffEvidence | undefined): readonly string[] {
  if (meaningfulDiff === undefined) {
    return [];
  }

  return meaningfulDiff.productFiles.length > 0 ? meaningfulDiff.productFiles : meaningfulDiff.newChangedFiles;
}

function extractTestsReported(agentCompletion: AgentCompletionReport | undefined): readonly string[] {
  if (agentCompletion === undefined || !agentCompletion.testsMentioned) {
    return [];
  }

  const lines = agentCompletion.summaryText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^tests?\s+run\s*:/iu.test(line));

  return lines.length === 0 ? ['Tests were mentioned in agent completion evidence.'] : lines;
}

function hasExplicitNoTests(agentCompletion: AgentCompletionReport | undefined): boolean {
  if (agentCompletion === undefined || !agentCompletion.testsMentioned) {
    return true;
  }

  const text = agentCompletion.summaryText.toLowerCase();
  return /tests?\s+run\s*:\s*(?:not\s+run|none|n\/a|no|skipped)/u.test(text) || /(?:no tests? (?:run|were run)|tests? (?:not run|skipped))/u.test(text);
}

function collectQualityCommands(report: QualityReport): readonly TestRelevanceQualityCommand[] {
  return [
    ...report.required.map((result) => toQualityCommand(result, 'required')),
    ...report.optional.map((result) => toQualityCommand(result, 'optional'))
  ].filter((command): command is TestRelevanceQualityCommand => command !== undefined);
}

function toQualityCommand(result: QualityGateResult, requirement: 'required' | 'optional'): TestRelevanceQualityCommand | undefined {
  if (result.command === undefined) {
    return undefined;
  }

  const command = result.command.trim();
  const relevant = isTestLikeGate(result.name) || isRealisticTestCommand(command) || isTrivialCommand(command);

  return {
    name: result.name,
    command,
    requirement,
    status: result.status,
    relevant,
    trivial: isTrivialCommand(command)
  };
}

function isTestLikeGate(name: string): boolean {
  return /(?:^|[-_:])(test|tests|e2e|coverage)(?:$|[-_:])/iu.test(name);
}

function isRealisticTestCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return realisticTestCommandPatterns.some((pattern) => pattern.test(normalized));
}

function isTrivialCommand(command: string): boolean {
  const normalized = normalizeCommand(command);

  return (
    normalized === 'mock test' ||
    normalized === 'true' ||
    normalized === ':' ||
    normalized.startsWith('echo ') ||
    /^node\s+-[ep]\s+/u.test(normalized) ||
    /console\.log\s*\(/u.test(normalized) ||
    /process\.exit\s*\(\s*0\s*\)/u.test(normalized)
  );
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/gu, ' ').toLowerCase();
}
