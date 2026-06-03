import type { BranchRef, DeliveryTicket, QualityReport, RepositoryRef, TicketAnalysis } from '../../domain/index.js';

export interface BuildDevelopPullRequestBodyInput {
  readonly ticket: DeliveryTicket;
  readonly analysis?: TicketAnalysis;
  readonly runId: string;
  readonly repository: RepositoryRef;
  readonly branch: BranchRef;
  readonly qualityReport: QualityReport;
  readonly risks?: readonly string[];
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
