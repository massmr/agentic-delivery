import type {
  AgentCompletionDecision,
  AgentCompletionFinding,
  AgentCompletionFindingKind,
  AgentCompletionReport,
  AgentCompletionStatusSignal,
  MeaningfulDiffEvidence
} from '../domain/index.js';

export interface EvaluateAgentCompletionInput {
  readonly implementationLogText: string;
  readonly devRunSummary?: string | undefined;
  readonly meaningfulDiff: MeaningfulDiffEvidence;
}

interface CompletionSummaryFields {
  readonly statusSignal: AgentCompletionStatusSignal;
  readonly changedFilesField?: string | undefined;
  readonly changedFiles: readonly string[];
  readonly testsRun?: string | undefined;
  readonly knownLimits?: string | undefined;
  readonly blockersField?: string | undefined;
  readonly blockers: readonly string[];
  readonly backgroundAgents?: string | undefined;
  readonly summaryText: string;
}

const emptyValues = new Set(['', 'none', 'n/a', 'na', 'not applicable', 'no', 'no blockers', 'no blocker', 'nothing']);
const completionFieldLabels = ['Status', 'Changed files', 'Tests run', 'Known limits', 'Blockers', 'Background agents'] as const;

export function evaluateAgentCompletion(input: EvaluateAgentCompletionInput): AgentCompletionReport {
  const summary = parseCompletionSummary(input.implementationLogText);
  const findings = [
    ...findStatusFindings(summary),
    ...findEvidenceFindings(summary, input.meaningfulDiff),
    ...findLanguageFindings(input.implementationLogText, summary),
    ...findBlockerFindings(summary)
  ];
  const decision = decide(findings);

  return {
    decision,
    reason: buildReason(decision, findings),
    source: input.devRunSummary === undefined || input.devRunSummary.trim().length === 0 ? 'implementation_log' : 'combined',
    statusSignal: summary.statusSignal,
    summaryText: summary.summaryText,
    changedFilesMentioned: summary.changedFiles,
    testsMentioned: isMeaningfulField(summary.testsRun),
    knownLimitsMentioned: isPresentField(summary.knownLimits),
    blockers: summary.blockers,
    findings
  };
}

function parseCompletionSummary(text: string): CompletionSummaryFields {
  const summaryText = extractSummaryText(text);
  const lines = summaryText.split(/\r?\n/u);
  const statusValue = findField(lines, 'Status');
  const statusSignal = parseStatus(statusValue);

  return {
    statusSignal,
    changedFilesField: findField(lines, 'Changed files'),
    changedFiles: parseListField(findField(lines, 'Changed files')),
    testsRun: findField(lines, 'Tests run'),
    knownLimits: findField(lines, 'Known limits'),
    blockersField: findField(lines, 'Blockers'),
    blockers: parseBlockers(findField(lines, 'Blockers')),
    backgroundAgents: findField(lines, 'Background agents'),
    summaryText
  };
}

function findField(lines: readonly string[], label: string): string | undefined {
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${escapeRegExp(label)}\\s*:\\s*(.*)$`, 'iu');
  const match = lines.map((line) => pattern.exec(line)).find((candidate): candidate is RegExpExecArray => candidate !== null);
  return match?.[1]?.trim();
}

function parseStatus(value: string | undefined): AgentCompletionStatusSignal {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'completed' || normalized === 'blocked' || normalized === 'incomplete') {
    return normalized;
  }

  return 'missing';
}

function parseListField(value: string | undefined): readonly string[] {
  if (value === undefined || isEmptyField(value)) {
    return [];
  }

  return uniqueNormalizedValues(value
    .split(/[,;]+/u)
    .map((item) => item.replace(/^[-*]\s*/u, '').trim())
    .filter((item) => item.length > 0));
}

function parseBlockers(value: string | undefined): readonly string[] {
  if (value === undefined || isEmptyField(value)) {
    return [];
  }

  return parseListField(value);
}

function extractSummaryText(text: string): string {
  const matches = [...text.matchAll(/(?:##\s*)?Required Final Completion Summary/giu)];
  const marker = matches.at(-1);
  const summary = marker === undefined ? findLastCompletionFieldBlock(text) ?? '' : text.slice(marker.index);
  return summary.trim().slice(0, 4000);
}

function findLastCompletionFieldBlock(text: string): string | undefined {
  const lines = text.split(/\r?\n/u);
  let candidate: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const statusValue = findLineField(lines[index] ?? '', 'Status');

    if (parseStatus(statusValue) === 'missing') {
      continue;
    }

    const block = buildCompletionFieldBlock(lines, index);

    if (block !== undefined) {
      candidate = block;
    }
  }

  return candidate;
}

function buildCompletionFieldBlock(lines: readonly string[], statusIndex: number): string | undefined {
  const searchEnd = findCompletionBlockSearchEnd(lines, statusIndex);
  const fieldIndexes = completionFieldLabels.map((label) => findFieldLineIndex(lines, label, statusIndex, searchEnd));

  if (fieldIndexes.some((index) => index === -1)) {
    return undefined;
  }

  const lastFieldIndex = Math.max(...fieldIndexes);
  return lines.slice(statusIndex, lastFieldIndex + 1).join('\n');
}

function findCompletionBlockSearchEnd(lines: readonly string[], statusIndex: number): number {
  const maxSearchEnd = Math.min(lines.length, statusIndex + 24);

  for (let index = statusIndex + 1; index < maxSearchEnd; index += 1) {
    if (/^\s*##\s+Attempt\s+\d+/iu.test(lines[index] ?? '') || /^\s*###\s+Stderr\b/iu.test(lines[index] ?? '')) {
      return index;
    }
  }

  return maxSearchEnd;
}

function findFieldLineIndex(lines: readonly string[], label: string, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (findLineField(lines[index] ?? '', label) !== undefined) {
      return index;
    }
  }

  return -1;
}

function findLineField(line: string, label: string): string | undefined {
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${escapeRegExp(label)}\\s*:\\s*(.*)$`, 'iu');
  return pattern.exec(line)?.[1]?.trim();
}

function findStatusFindings(summary: CompletionSummaryFields): readonly AgentCompletionFinding[] {
  if (summary.statusSignal === 'completed') {
    return [];
  }

  if (summary.statusSignal === 'blocked') {
    return [finding('blocked_status', blockerDecision(summary.blockers), 'Agent reported blocked completion status.')];
  }

  if (summary.statusSignal === 'incomplete') {
    return [finding('incomplete_status', 'fail', 'Agent reported incomplete completion status.')];
  }

  return [finding('missing_completed_status', 'fail', 'Agent did not provide a structured completed status signal.')];
}

function findEvidenceFindings(summary: CompletionSummaryFields, meaningfulDiff: MeaningfulDiffEvidence): readonly AgentCompletionFinding[] {
  const findings: AgentCompletionFinding[] = [];

  if (meaningfulDiff.decision !== 'passed' || meaningfulDiff.productFiles.length === 0) {
    findings.push(finding('diff_not_meaningful', 'fail', 'Meaningful product diff evidence did not pass.'));
  }

  if (!mentionsChangedProductFile(summary.changedFiles, meaningfulDiff.productFiles)) {
    findings.push(finding('missing_changed_files', 'fail', 'Completion summary did not mention an agent-changed product file.'));
  }

  if (!isMeaningfulField(summary.testsRun)) {
    findings.push(finding('missing_tests', 'fail', 'Completion summary did not state tests run or tests not run.'));
  }

  if (!isPresentField(summary.knownLimits)) {
    findings.push(finding('missing_known_limits', 'fail', 'Completion summary did not state known limits.'));
  }

  return findings;
}

function findLanguageFindings(_text: string, summary: CompletionSummaryFields): readonly AgentCompletionFinding[] {
  const lowerText = summary.summaryText.toLowerCase();
  const findings: AgentCompletionFinding[] = [];

  if (/\b(?:looked into|investigated|explored|recommend|recommendation|no changes made|did not change)\b/iu.test(lowerText)) {
    findings.push(finding('exploration_only', 'fail', 'Agent output appears exploration-only or reports no implementation.'));
  }

  if (/\b(?:will implement|todo|remaining work|not implemented|partially implemented|unfinished)\b/iu.test(lowerText)) {
    findings.push(finding('incomplete_language', 'fail', 'Agent output contains incomplete-work language.'));
  }

  const backgroundAgents = summary.backgroundAgents;
  if (backgroundAgents !== undefined && isMeaningfulField(backgroundAgents) && !/\b(?:none|no pending|not pending|complete|completed)\b/iu.test(backgroundAgents)) {
    findings.push(finding('pending_background_agents', 'fail', 'Completion summary reports pending background agents.'));
  }

  if (/\bwaiting for background agents\b/iu.test(lowerText)) {
    findings.push(finding('pending_background_agents', 'fail', 'Agent output ended while waiting for background agents.'));
  }

  return findings;
}

function findBlockerFindings(summary: CompletionSummaryFields): readonly AgentCompletionFinding[] {
  if (summary.blockers.length === 0) {
    return [];
  }

  return [finding('unresolved_blockers', blockerDecision(summary.blockers), 'Completion summary reports unresolved blockers.')];
}

function blockerDecision(blockers: readonly string[]): AgentCompletionDecision {
  const text = blockers.join(' ').toLowerCase();
  return /\b(?:credential|credentials|access|permission|auth|login|human|operator|approval|clarification|clarify)\b/u.test(text) ? 'needs_human' : 'fail';
}

function decide(findings: readonly AgentCompletionFinding[]): AgentCompletionDecision {
  if (findings.some((item) => item.severity === 'fail')) {
    return 'fail';
  }

  if (findings.some((item) => item.severity === 'needs_human')) {
    return 'needs_human';
  }

  return 'pass';
}

function buildReason(decision: AgentCompletionDecision, findings: readonly AgentCompletionFinding[]): string {
  if (decision === 'pass') {
    return 'Agent completion passed: structured completed status, changed files, tests, known limits, no blockers, and no pending background agents were reported.';
  }

  const messages = findings.map((item) => item.message);
  const uniqueMessages = [...new Set(messages)];
  return decision === 'needs_human'
    ? `Agent completion needs human review: ${uniqueMessages.join(' ')}`
    : `Agent completion failed: ${uniqueMessages.join(' ')}`;
}

function mentionsChangedProductFile(mentioned: readonly string[], productFiles: readonly string[]): boolean {
  if (productFiles.length === 0 || mentioned.length === 0) {
    return false;
  }

  const normalizedMentioned = mentioned.map(normalizePath);
  return productFiles.map(normalizePath).some((productFile) => normalizedMentioned.some((item) => item === productFile || item.endsWith(`/${productFile}`) || productFile.endsWith(`/${item}`)));
}

function finding(kind: AgentCompletionFindingKind, severity: AgentCompletionDecision, message: string): AgentCompletionFinding {
  return { kind, severity, message };
}

function isEmptyField(value: string | undefined): boolean {
  return value === undefined || emptyValues.has(value.trim().toLowerCase());
}

function isPresentField(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function isMeaningfulField(value: string | undefined): boolean {
  return !isEmptyField(value);
}

function uniqueNormalizedValues(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizePath).filter((item) => item.length > 0))];
}

function normalizePath(value: string): string {
  return value.replace(/`/gu, '').replace(/\\/gu, '/').replace(/^\.\//u, '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
