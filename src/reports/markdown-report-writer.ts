import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { DeploymentResult } from '../domain/deployment.js';
import type { DevRunResult } from '../domain/dev-runner.js';
import type { PullRequestRef } from '../domain/pull-request.js';
import type { QualityGateResult, QualityReport } from '../domain/quality.js';
import type { BranchRef, DeliveryRunFailure, DeliveryRunStateRecord, TestRelevanceReport } from '../domain/run.js';
import type { TicketPlan } from '../planning/repository-resolver.js';
import { getRunDirectoryPath } from '../state/run-state-store.js';

export interface FinalReportOptions {
  readonly planReportPath?: string;
  readonly implementationLogPath?: string;
  readonly meaningfulDiffReportPath?: string;
  readonly agentCompletionReportPath?: string;
  readonly coreSafetyReportPath?: string;
  readonly qualityReportPath?: string;
  readonly testRelevanceReportPath?: string;
  readonly stagingReportPath?: string;
  readonly mockOnlyNote?: string;
}

export class MarkdownReportWriter {
  constructor(private readonly rootPath: string = process.cwd()) {}

  async writePlan(runId: string, plan: TicketPlan): Promise<string> {
    const relativePath = join(getRunDirectoryPath(plan.ticket.ref.key, runId), 'plan.md');
    const outputPath = join(this.rootPath, relativePath);
    const body = renderTicketPlanMarkdown(runId, plan);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, body, 'utf8');

    return relativePath;
  }

  async writeQuality(ticketKey: string, runId: string, report: QualityReport): Promise<string> {
    const relativePath = join(getRunDirectoryPath(ticketKey, runId), 'quality-report.md');
    const outputPath = join(this.rootPath, relativePath);
    const body = renderQualityReportMarkdown(ticketKey, runId, report);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, body, 'utf8');

    return relativePath;
  }

  async writeStaging(ticketKey: string, runId: string, deployment: DeploymentResult, failure?: DeliveryRunFailure): Promise<string> {
    const relativePath = join(getRunDirectoryPath(ticketKey, runId), 'staging-report.md');
    const outputPath = join(this.rootPath, relativePath);
    const body = renderStagingReportMarkdown(ticketKey, runId, deployment, failure);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, body, 'utf8');

    return relativePath;
  }

  async writeFinal(ticketKey: string, runId: string, state: DeliveryRunStateRecord, options: FinalReportOptions = {}): Promise<string> {
    const relativePath = join(getRunDirectoryPath(ticketKey, runId), 'final-report.md');
    const outputPath = join(this.rootPath, relativePath);
    const body = renderFinalReportMarkdown(ticketKey, runId, state, options);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, body, 'utf8');

    return relativePath;
  }
}

export function renderTicketPlanMarkdown(runId: string, plan: TicketPlan): string {
  const selectedRepositories =
    plan.selectedRepositories.length === 0
      ? '- None'
      : plan.selectedRepositories.map((repository) => `- ${repository.owner}/${repository.name} (${repository.defaultBranch})`).join('\n');
  const matches = plan.repositoryMatches
    .map((match) => `- ${match.repository.owner}/${match.repository.name}: ${match.confidence.toFixed(2)} - ${match.reasoning}`)
    .join('\n');
  const requirements = plan.analysis.requirements.map((requirement) => `- ${requirement}`).join('\n');
  const constraints = plan.analysis.constraints.map((constraint) => `- ${constraint}`).join('\n');
  const risks = plan.analysis.risks.length === 0 ? '- None identified in mock planning.' : plan.analysis.risks.map((risk) => `- ${risk}`).join('\n');
  const humanInputStatus = plan.needsHuman ? plan.humanReason ?? 'Human input required before delivery.' : 'Not required for this dry-run plan.';

  return [
    `# Plan ${plan.ticket.ref.key}`,
    '',
    `Run: ${runId}`,
    `Ticket: [${plan.ticket.ref.key}](${plan.ticket.ref.url})`,
    `Status: ${plan.needsHuman ? 'NEEDS_HUMAN' : 'PLANNED'}`,
    '',
    '## Goal',
    '',
    plan.analysis.goal,
    '',
    '## Requirements',
    '',
    requirements,
    '',
    '## Selected Repositories',
    '',
    selectedRepositories,
    '',
    '## Repository Matches',
    '',
    matches.length === 0 ? '- None' : matches,
    '',
    '## Human Input Status',
    '',
    humanInputStatus,
    '',
    '## Dry Run Boundary',
    '',
    'No branch creation, OpenCode execution, package scripts, operation ledger, GitHub, Railway/Vercel, pull request, deployment, production merge, or production deploy is performed by this planning command.',
    '',
    '## Constraints',
    '',
    constraints,
    '',
    '## Risks',
    '',
    risks,
    ...(plan.humanReason === undefined ? [] : ['', '## Human Action Needed', '', plan.humanReason]),
    ''
  ].join('\n');
}

export function renderQualityReportMarkdown(ticketKey: string, runId: string, report: QualityReport): string {
  return [
    `# Quality Report ${ticketKey}`,
    '',
    `Run: ${runId}`,
    `Status: ${report.status.toUpperCase()}`,
    '',
    '## Required Gates',
    '',
    renderGateResults(report.required),
    '',
    '## Optional Gates',
    '',
    renderGateResults(report.optional),
    '',
    '## Test Relevance',
    '',
    renderTestRelevance(report.testRelevance, undefined),
    ''
  ].join('\n');
}

export function renderStagingReportMarkdown(ticketKey: string, runId: string, deployment: DeploymentResult, failure?: DeliveryRunFailure): string {
  return [
    `# Staging Report ${ticketKey}`,
    '',
    `Run: ${runId}`,
    `Status: ${deployment.status.toUpperCase()}`,
    `Provider: ${deployment.ref.provider}`,
    `Environment: ${deployment.ref.environment}`,
    `Deployment ID: ${deployment.ref.deploymentId}`,
    `Branch: ${deployment.branch}`,
    `Commit SHA: ${deployment.commitSha}`,
    `Service URL: ${deployment.serviceUrl}`,
    `Started At: ${deployment.startedAt}`,
    `Finished At: ${deployment.finishedAt ?? 'n/a'}`,
    '',
    '## Deployment Summary',
    '',
    deployment.summary,
    '',
    '## Smoke Checks',
    '',
    renderSmokeChecks(deployment.smokeChecks),
    '',
    '## Failure Summary',
    '',
    failure === undefined ? '- None' : `- ${failure.state}: ${failure.reason}`,
    ''
  ].join('\n');
}

function renderSmokeChecks(results: DeploymentResult['smokeChecks']): string {
  if (results.length === 0) {
    return '- None configured; smoke checks skipped.';
  }

  return results
    .map((result) => {
      const statusCode = result.statusCode === undefined ? 'n/a' : String(result.statusCode);
      return `- ${result.url}: ${result.status.toUpperCase()} (${statusCode}) - ${result.summary}`;
    })
    .join('\n');
}

function renderGateResults(results: readonly QualityGateResult[]): string {
  if (results.length === 0) {
    return '- None';
  }

  return results.map(renderGateResult).join('\n');
}

function renderGateResult(result: QualityGateResult): string {
  const command = result.command === undefined ? 'not configured' : result.command;

  return [
    `- ${result.name}: ${result.status.toUpperCase()} - ${result.summary}`,
    `  - Requirement: ${result.exitCode === null && result.status === 'skipped' ? 'optional warning' : 'executed'}`,
    `  - Command: ${command}`,
    `  - Exit Code: ${result.exitCode === null ? 'n/a' : String(result.exitCode)}`,
    `  - Stdout Log: ${result.stdoutLogPath}`,
    `  - Stderr Log: ${result.stderrLogPath}`
  ].join('\n');
}

export function renderFinalReportMarkdown(
  ticketKey: string,
  runId: string,
  state: DeliveryRunStateRecord,
  options: FinalReportOptions = {}
): string {
  const latestDevRun = state.devRuns[state.devRuns.length - 1];
  const latestQualityReport = state.qualityReports[state.qualityReports.length - 1];
  const developPullRequest = state.pullRequests.find((pullRequest) => pullRequest.targetBranch === 'develop');
  const productionPullRequest = state.pullRequests.find((pullRequest) => pullRequest.targetBranch === 'main');
  const latestDeployment = state.stagingDeployments[state.stagingDeployments.length - 1];

  return [
    `# Final Report ${ticketKey}`,
    '',
    `Run ID: ${runId}`,
    `Final State: ${state.state}`,
    `Ticket: [${state.ticket.key}](${state.ticket.url})`,
    '',
    '## Selected Repositories',
    '',
    renderRepositories(state),
    '',
    '## Branch References',
    '',
    renderBranches(state.branches),
    '',
    '## Develop Handoff Commit',
    '',
    renderDevelopHandoffCommit(state),
    '',
    '## Plan',
    '',
    `- Plan Report: ${options.planReportPath ?? 'not recorded'}`,
    `- Goal: ${state.ticketAnalysis?.goal ?? 'not recorded'}`,
    '',
    '## Development Run',
    '',
    renderDevRun(latestDevRun, options.implementationLogPath),
    '',
    '## Meaningful Diff',
    '',
    renderMeaningfulDiff(state.meaningfulDiff, options.meaningfulDiffReportPath),
    '',
    '## Agent Completion',
    '',
    renderAgentCompletion(state.agentCompletion, options.agentCompletionReportPath),
    '',
    '## Core Safety',
    '',
    renderCoreSafety(state.coreSafety, options.coreSafetyReportPath),
    '',
    '## Quality Summary',
    '',
    renderQualitySummary(latestQualityReport, options.qualityReportPath),
    '',
    '## Test Relevance',
    '',
    renderTestRelevance(state.testRelevance ?? latestQualityReport?.testRelevance, options.testRelevanceReportPath),
    '',
    '## Develop Pull Request',
    '',
    renderPullRequest(developPullRequest),
    '',
    '## Develop Pull Request Follow-Up',
    '',
    renderDevelopPullRequestFollowUp(state.developPullRequestFollowUp),
    '',
    '## Staging Verification',
    '',
    renderStagingSummary(latestDeployment, options.stagingReportPath),
    '',
    '## Production Pull Request',
    '',
    renderPullRequest(productionPullRequest),
    '',
    '## Final State',
    '',
    `- ${state.state}`,
    '',
    '## Mock-Only And Human Approval Note',
    '',
    options.mockOnlyNote ??
      'This run used mock Jira, mock GitHub, mock Railway, and mock OpenCode/local-only interfaces. Production merge remains human-only; no production deployment or merge was performed.',
    ''
  ].join('\n');
}

function renderRepositories(state: DeliveryRunStateRecord): string {
  if (state.targetRepositories.length === 0) {
    return '- None selected.';
  }

  return state.targetRepositories.map((repository) => `- ${repository.owner}/${repository.name} (${repository.url})`).join('\n');
}

function renderBranches(branches: readonly BranchRef[]): string {
  if (branches.length === 0) {
    return '- None recorded.';
  }

  return branches.map((branch) => `- ${branch.repository.owner}/${branch.repository.name}: ${branch.name} from ${branch.baseBranch} at ${branch.headSha ?? 'unknown head'}`).join('\n');
}

function renderDevelopHandoffCommit(state: DeliveryRunStateRecord): string {
  const commit = state.developHandoffCommit;

  if (commit === undefined) {
    return '- No scoped agent diff commit recorded.';
  }

  return [
    `- Repository: ${commit.repository.owner}/${commit.repository.name}`,
    `- Branch: ${commit.branchName}`,
    `- Commit SHA: ${commit.commitSha}`,
    `- Message: ${commit.message}`,
    `- Staged Files: ${renderInlineList(commit.stagedFiles)}`
  ].join('\n');
}

function renderDevRun(devRun: DevRunResult | undefined, implementationLogPath: string | undefined): string {
  if (devRun === undefined) {
    return '- No development run recorded.';
  }

  return [
    `- Status: ${devRun.status.toUpperCase()}`,
    `- Summary: ${devRun.summary}`,
    `- Implementation Log: ${implementationLogPath ?? devRun.implementationLogPath}`,
    `- Attempts: ${devRun.attempts.length}`
  ].join('\n');
}

function renderMeaningfulDiff(evidence: DeliveryRunStateRecord['meaningfulDiff'], reportPath: string | undefined): string {
  if (evidence === undefined) {
    return '- No meaningful diff decision recorded.';
  }

  return [
    `- Decision: ${evidence.decision.toUpperCase()}`,
    `- Reason: ${evidence.reason}`,
    `- Evidence: ${reportPath ?? 'not recorded'}`,
    `- Baseline Changed Files: ${renderInlineList(evidence.baselineChangedFiles)}`,
    `- After-Agent Changed Files: ${renderInlineList(evidence.afterAgentChangedFiles)}`,
    `- Agent-New Changed Files: ${renderInlineList(evidence.newChangedFiles)}`,
    `- Agent Product Changed Files: ${renderInlineList(evidence.productFiles)}`,
    `- Agent Ignored Files: ${renderInlineList(evidence.ignoredFiles)}`,
    `- Ignored Path Patterns: ${renderInlineList(evidence.ignoredPathPatterns)}`,
    `- Baseline Diff Summary: ${evidence.baselineDiffSummary.length === 0 ? 'not recorded' : evidence.baselineDiffSummary}`,
    `- After-Agent Diff Summary: ${evidence.afterAgentDiffSummary.length === 0 ? 'not recorded' : evidence.afterAgentDiffSummary}`
  ].join('\n');
}

function renderCoreSafety(report: DeliveryRunStateRecord['coreSafety'], reportPath: string | undefined): string {
  if (report === undefined) {
    return '- No core safety decision recorded.';
  }

  return [
    `- Decision: ${report.decision.toUpperCase()}`,
    `- Reason: ${report.reason}`,
    `- Evidence: ${reportPath ?? 'not recorded'}`,
    `- Changed Files: ${renderInlineList(report.changedFiles)}`,
    `- Changed File Count: ${report.changedFileCount}`,
    `- Added Line Count: ${report.addedLineCount}`,
    `- Limits: ${report.limits.maxChangedFiles} changed files, ${report.limits.maxAddedLines} added lines`,
    `- Forbidden Files: ${report.forbiddenFiles.length === 0 ? 'none' : report.forbiddenFiles.map((finding) => `${finding.filePath} (${finding.reason})`).join('; ')}`,
    `- Secret-Like Findings: ${report.secretFindings.length === 0 ? 'none' : report.secretFindings.map((finding) => `${finding.filePath}${finding.lineNumber === undefined ? '' : `:${finding.lineNumber}`} (${finding.detector})`).join('; ')}`,
    `- Diff Limit Findings: ${report.limitFindings.length === 0 ? 'none' : report.limitFindings.map((finding) => `${finding.limit} ${finding.actual}/${finding.maximum}`).join('; ')}`,
    `- Human Review Findings: ${report.humanReviewFindings.length === 0 ? 'none' : report.humanReviewFindings.map((finding) => `${finding.filePath} (${finding.category})`).join('; ')}`
  ].join('\n');
}

function renderAgentCompletion(report: DeliveryRunStateRecord['agentCompletion'], reportPath: string | undefined): string {
  if (report === undefined) {
    return '- No agent completion decision recorded.';
  }

  return [
    `- Decision: ${report.decision.toUpperCase()}`,
    `- Reason: ${report.reason}`,
    `- Evidence: ${reportPath ?? 'not recorded'}`,
    `- Status Signal: ${report.statusSignal.toUpperCase()}`,
    `- Changed Files Mentioned: ${renderInlineList(report.changedFilesMentioned)}`,
    `- Tests Mentioned: ${report.testsMentioned ? 'yes' : 'no'}`,
    `- Known Limits Mentioned: ${report.knownLimitsMentioned ? 'yes' : 'no'}`,
    `- Blockers: ${renderInlineList(report.blockers)}`,
    `- Findings: ${report.findings.length === 0 ? 'none' : report.findings.map((finding) => `${finding.kind} (${finding.severity})`).join('; ')}`
  ].join('\n');
}

function renderQualitySummary(report: QualityReport | undefined, reportPath: string | undefined): string {
  if (report === undefined) {
    return '- No quality report recorded.';
  }

  return [
    `- Status: ${report.status.toUpperCase()}`,
    `- Quality Report: ${reportPath ?? 'not recorded'}`,
    `- Required Gates: ${report.required.map((result) => `${result.name} ${result.status.toUpperCase()}`).join(', ') || 'none'}`,
    `- Optional Gates: ${report.optional.map((result) => `${result.name} ${result.status.toUpperCase()}`).join(', ') || 'none'}`
  ].join('\n');
}

function renderTestRelevance(report: TestRelevanceReport | undefined, reportPath: string | undefined): string {
  if (report === undefined) {
    return '- Not evaluated';
  }

  return [
    `- Decision: ${report.decision.toUpperCase()}`,
    `- Reason: ${report.reason}`,
    `- Evidence: ${reportPath ?? 'embedded in quality report'}`,
    `- Changed Files: ${renderInlineList(report.changedFiles)}`,
    `- Tests Reported: ${renderInlineList(report.testsReported)}`,
    `- Quality Commands: ${report.qualityCommands.length === 0 ? 'none' : report.qualityCommands.map((command) => `${command.name} ${command.status.toUpperCase()} (${command.command})`).join('; ')}`,
    `- Findings: ${report.findings.length === 0 ? 'none' : report.findings.map((finding) => `${finding.kind} (${finding.severity})`).join('; ')}`,
    `- Trivial Command Patterns: ${renderInlineList(report.trivialCommandPatterns)}`
  ].join('\n');
}

function renderInlineList(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join(', ');
}

function renderPullRequest(pullRequest: PullRequestRef | undefined): string {
  if (pullRequest === undefined) {
    return '- No pull request recorded.';
  }

  return [
    `- PR: [#${pullRequest.number}](${pullRequest.url})`,
    `- Repository: ${pullRequest.repositoryOwner}/${pullRequest.repositoryName}`,
    `- Source: ${pullRequest.sourceBranch}`,
    `- Target: ${pullRequest.targetBranch}`,
    `- Status: ${pullRequest.status}`
  ].join('\n');
}

function renderDevelopPullRequestFollowUp(evidence: DeliveryRunStateRecord['developPullRequestFollowUp']): string {
  if (evidence === undefined) {
    return '- No develop pull request follow-up evidence recorded.';
  }

  return [
    `- Decision: ${evidence.decision.toUpperCase()}`,
    `- Reason: ${evidence.reason}`,
    `- Observed At: ${evidence.observedAt}`,
    `- PR Status: ${evidence.pullRequest.status}`,
    `- Checks: ${evidence.checks.status.toUpperCase()} (${evidence.checks.passedCount}/${evidence.checks.totalCount} passed, ${evidence.checks.failedCount} failed, ${evidence.checks.pendingCount} pending)`,
    `- No Remote Checks Policy: ${evidence.noRemoteChecksPolicy}`,
    `- Develop Auto Merge: ${evidence.autoMerge ? 'enabled' : 'disabled'}`,
    `- Merge Method: ${evidence.mergeMethod}`,
    `- Merge Result: ${evidence.mergeResult === undefined ? 'none' : `${evidence.mergeResult.pullRequest.status} ${evidence.mergeResult.commitSha ?? 'unknown commit'}`}`
  ].join('\n');
}

function renderStagingSummary(deployment: DeploymentResult | undefined, reportPath: string | undefined): string {
  if (deployment === undefined) {
    return '- No staging deployment recorded.';
  }

  return [
    `- Status: ${deployment.status.toUpperCase()}`,
    `- Staging Report: ${reportPath ?? 'not recorded'}`,
    `- Deployment: ${deployment.ref.deploymentId}`,
    `- Branch: ${deployment.branch}`,
    `- Service URL: ${deployment.serviceUrl}`,
    `- Smoke Checks: ${deployment.smokeChecks.length === 0 ? 'none configured' : deployment.smokeChecks.map((check) => `${check.url} ${check.status.toUpperCase()}`).join(', ')}`
  ].join('\n');
}
