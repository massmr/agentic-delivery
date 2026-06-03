import type { BranchRef, DeliveryTicket, DeploymentResult, PullRequestRef, QualityReport, RepositoryRef, TicketAnalysis } from '../../domain/index.js';

export interface BuildDevelopPullRequestBodyInput {
  readonly ticket: DeliveryTicket;
  readonly analysis?: TicketAnalysis;
  readonly runId: string;
  readonly repository: RepositoryRef;
  readonly branch: BranchRef;
  readonly qualityReport: QualityReport;
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
    'This production pull request is prepared for human review only. Agentic Delivery must not merge it, deploy production, push production branches, or bypass approval.',
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
    '## Risks',
    '',
    ...formatList(risks, 'No known risks recorded.'),
    '',
    '## Local/Mock-Only Note',
    '',
    'This handoff was produced with local git and mock GitHub interfaces only. No real remote push, GitHub API call, credentials, or production branch action was performed.',
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

function summarizeSmokeStatus(deployment: DeploymentResult): string {
  if (deployment.smokeChecks.length === 0) {
    return 'SKIPPED - no smoke URLs configured.';
  }

  const passedCount = deployment.smokeChecks.filter((check) => check.status === 'passed').length;
  const failedCount = deployment.smokeChecks.filter((check) => check.status === 'failed').length;
  const skippedCount = deployment.smokeChecks.filter((check) => check.status === 'skipped').length;

  return `${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped.`;
}
