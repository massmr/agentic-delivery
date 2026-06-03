import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { QualityGateResult, QualityReport } from '../domain/quality.js';
import type { TicketPlan } from '../planning/repository-resolver.js';
import { getRunDirectoryPath } from '../state/run-state-store.js';

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
    matches,
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
    ''
  ].join('\n');
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
