import type { BranchRef, CoreSafetyReport, DeliveryTicket, DeploymentResult, MeaningfulDiffEvidence, PullRequestRef, QualityReport, RepositoryRef, TestRelevanceReport, TicketAnalysis } from '../../domain/index.js';

export interface BuildDevelopPullRequestBodyInput {
  readonly ticket: DeliveryTicket;
  readonly analysis?: TicketAnalysis;
  readonly runId: string;
  readonly repository: RepositoryRef;
  readonly branch: BranchRef;
  readonly qualityReport: QualityReport;
  readonly meaningfulDiff?: MeaningfulDiffEvidence | undefined;
  readonly coreSafety?: CoreSafetyReport | undefined;
  readonly testRelevance?: TestRelevanceReport | undefined;
  readonly risks?: readonly string[];
}

export interface BuildProductionPullRequestBodyInput {
  readonly ticket: DeliveryTicket;
  readonly analysis?: TicketAnalysis;
  readonly runId: string;
  readonly repository: RepositoryRef;
  readonly developPullRequest: PullRequestRef;
  readonly stagingDeployment: DeploymentResult;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly risks?: readonly string[];
}

export function buildProductionPullRequestBody(input: BuildProductionPullRequestBodyInput): string {
  const risks = input.risks ?? input.analysis?.risks ?? [];
  const failedOrSkippedSmokeChecks = input.stagingDeployment.smokeChecks.filter((check) => check.status !== 'passed');

  return [
    `# ${input.ticket.ref.key}: Production approval request`,
    '',
    '## Jira',
    '',
    `- Ticket: [${input.ticket.ref.key}](${input.ticket.ref.url})`,
    `- Summary: ${input.ticket.summary}`,
    '',
    '## Run',
    '',
    `- Run ID: ${input.runId}`,
    `- Repository: ${input.repository.owner}/${input.repository.name}`,
    '',
    '## Staging And Develop Evidence',
    '',
    `- Develop PR: [#${input.developPullRequest.number}](${input.developPullRequest.url})`,
    `- Develop PR Target: ${input.developPullRequest.targetBranch}`,
    `- Staging Deployment: ${input.stagingDeployment.ref.deploymentId}`,
    `- Staging Status: ${input.stagingDeployment.status.toUpperCase()}`,
    `- Staging Branch: ${input.stagingDeployment.branch}`,
    `- Staging Service URL: ${input.stagingDeployment.serviceUrl}`,
    `- Smoke Status: ${summarizeSmokeStatus(input.stagingDeployment)}`,
    ...(failedOrSkippedSmokeChecks.length === 0 ? [] : failedOrSkippedSmokeChecks.map((check) => `- Smoke Attention: ${check.url} ${check.status.toUpperCase()} - ${check.summary}`)),
    '',
    '## Production Pull Request Target',
    '',
    `- Source Branch: ${input.sourceBranch}`,
    `- Target Branch: ${input.targetBranch}`,
    '',
    '## Risks',
    '',
    ...formatList(risks, 'No known risks recorded.'),
    '',
    '## Human-Only Production Merge',
    '',
    'This production pull request is prepared for human review only. Ewokbot must not merge it, deploy production, push production branches, or bypass approval.',
    ''
  ].join('\n');
}

export function buildDevelopPullRequestBody(input: BuildDevelopPullRequestBodyInput): string {
  const risks = input.risks ?? input.analysis?.risks ?? [];

  return [
    `# ${input.ticket.ref.key}: ${input.ticket.summary}`,
    '',
    '## Jira',
    '',
    `- Ticket: [${input.ticket.ref.key}](${input.ticket.ref.url})`,
    `- Summary: ${input.ticket.summary}`,
    '',
    '## Run',
    '',
    `- Run ID: ${input.runId}`,
    `- Repository: ${input.repository.owner}/${input.repository.name}`,
    `- Branch: ${input.branch.name}`,
    `- Target: develop`,
    '',
    '## Quality',
    '',
    `- Status: ${input.qualityReport.status.toUpperCase()}`,
    '- Required:',
    ...formatQualityResults(input.qualityReport.required),
    '- Optional:',
    ...formatQualityResults(input.qualityReport.optional),
    '',
    '## Local Evidence',
    '',
    `- Meaningful Diff: ${formatMeaningfulDiff(input.meaningfulDiff)}`,
    `- Core Safety: ${formatCoreSafety(input.coreSafety)}`,
    `- Test Relevance: ${formatTestRelevance(input.testRelevance)}`,
    '',
    '## Risks',
    '',
    ...formatList(risks, 'No known risks recorded.'),
    '',
    '## Local-Only Handoff Notes',
    '',
    'This develop draft PR handoff is based on local evidence. Branch push uses the local git/native fallback; GitHub handoff uses typed CodeHostPort operations and requires explicit MCP policy for develop PR creation.',
    'No production PR, merge, deployment, production branch push, or production approval bypass is performed by this handoff.',
    ''
  ].join('\n');
}

function formatQualityResults(results: QualityReport['required']): readonly string[] {
  if (results.length === 0) {
    return ['  - None recorded.'];
  }

  return results.map((result) => `  - ${result.name}: ${result.status.toUpperCase()} - ${result.summary}`);
}

function formatList(items: readonly string[], emptyMessage: string): readonly string[] {
  if (items.length === 0) {
    return [`- ${emptyMessage}`];
  }

  return items.map((item) => `- ${item}`);
}

function formatMeaningfulDiff(evidence: MeaningfulDiffEvidence | undefined): string {
  if (evidence === undefined) {
    return 'MISSING - no meaningful diff evidence recorded.';
  }

  return `${evidence.decision.toUpperCase()} - ${evidence.reason}; ${evidence.productFiles.length} product file(s). ${evidence.diffSummary}`;
}

function formatCoreSafety(report: CoreSafetyReport | undefined): string {
  if (report === undefined) {
    return 'MISSING - no core safety report recorded.';
  }

  return `${report.decision.toUpperCase()} - ${report.reason}; ${report.changedFileCount} changed file(s), ${report.addedLineCount} added line(s).`;
}

function formatTestRelevance(report: TestRelevanceReport | undefined): string {
  if (report === undefined) {
    return 'MISSING - no test relevance report recorded.';
  }

  return `${report.decision.toUpperCase()} - ${report.reason}; tests reported: ${formatInlineList(report.testsReported)}.`;
}

function formatInlineList(items: readonly string[]): string {
  if (items.length === 0) {
    return 'none';
  }

  return items.join(', ');
}

function summarizeSmokeStatus(deployment: DeploymentResult): string {
  if (deployment.smokeChecks.length === 0) {
    return 'SKIPPED - no smoke URLs configured.';
  }

  const passedCount = deployment.smokeChecks.filter((check) => check.status === 'passed').length;
  const failedCount = deployment.smokeChecks.filter((check) => check.status === 'failed').length;
  const skippedCount = deployment.smokeChecks.filter((check) => check.status === 'skipped').length;

  return `${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped.`;
}
