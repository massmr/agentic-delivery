import type { DeliveryTicket, QualityGateDefinition, RepositoryConfig, TicketAnalysis } from '../../domain/index.js';

export interface OpenCodePromptBranchInput {
  readonly name: string;
  readonly baseBranch: string;
}

export interface OpenCodePromptInput {
  readonly ticket: DeliveryTicket;
  readonly analysis: TicketAnalysis;
  readonly repository: RepositoryConfig;
  readonly branch: OpenCodePromptBranchInput;
  readonly definitionOfDone: readonly string[];
}

export function buildOpenCodeImplementationPrompt(input: OpenCodePromptInput): string {
  return [
    '# OpenCode Implementation Task',
    '',
    '## Ticket',
    `- Key: ${input.ticket.ref.key}`,
    `- URL: ${input.ticket.ref.url}`,
    `- Summary: ${input.ticket.summary}`,
    '- Description:',
    formatBlock(input.ticket.description),
    '',
    '## Analysis',
    `- Goal: ${input.analysis.goal}`,
    formatList('Requirements', input.analysis.requirements),
    formatList('Constraints', input.analysis.constraints),
    formatList('Risks', input.analysis.risks),
    '',
    '## Repository',
    `- Provider: ${input.repository.ref.provider}`,
    `- Owner: ${input.repository.ref.owner}`,
    `- Name: ${input.repository.ref.name}`,
    `- URL: ${input.repository.ref.url}`,
    `- Local path: ${input.repository.localPath}`,
    `- Role: ${input.repository.role}`,
    '',
    '## Branch',
    `- Working branch: ${input.branch.name}`,
    `- Base branch: ${input.branch.baseBranch}`,
    `- Repository default branch: ${input.repository.ref.defaultBranch}`,
    '',
    '## Quality Policy',
    formatQualityPolicy(input.repository.qualityGates),
    '',
    '## Definition Of Done',
    formatListItems(input.definitionOfDone),
    '',
    '## Required Final Completion Summary',
    'Finish implementation before claiming completion. Exploration-only work, unfinished todos, unresolved blockers, or pending background agents must not be reported as completed.',
    'End your response with exactly these fields:',
    'Status: completed | blocked | incomplete',
    'Changed files: comma-separated paths changed by this implementation, or none',
    'Tests run: commands run, or not run with reason',
    'Known limits: remaining limits, or none',
    'Blockers: unresolved blockers, or none',
    'Background agents: pending background agents/tasks, or none',
    '',
    '## Local Mock-Only Guardrails',
    '- Do not call real Jira, GitHub, Railway, OpenCode provider APIs, or any other network service.',
    '- Do not read, request, print, or persist credentials or secrets.',
    '- Do not push to production, merge production branches, or change production deployment configuration.',
    '- Keep this run local and auditable; write implementation evidence into the run folder only.',
    ''
  ].join('\n');
}

function formatBlock(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => `  ${line}`)
    .join('\n');
}

function formatList(title: string, values: readonly string[]): string {
  return [`- ${title}:`, formatListItems(values)].join('\n');
}

function formatListItems(values: readonly string[]): string {
  if (values.length === 0) {
    return '  - None specified.';
  }

  return values.map((value) => `  - ${value}`).join('\n');
}

function formatQualityPolicy(gates: readonly QualityGateDefinition[]): string {
  if (gates.length === 0) {
    return '- No local quality gates configured. Treat this as a blocker before any future push or PR handoff.';
  }

  return gates.map(formatQualityGate).join('\n');
}

function formatQualityGate(gate: QualityGateDefinition): string {
  if (gate.command === undefined) {
    return `- ${gate.requirement.toUpperCase()} ${gate.name}: missing command; warn and skip only if optional policy allows it.`;
  }

  return `- ${gate.requirement.toUpperCase()} ${gate.name}: ${gate.command}`;
}
