import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/workspace-config.js';
import type { WorkspaceConfig } from '../../config/workspace-config.js';
import type { DeliveryTicket } from '../../domain/index.js';
import { mapMcpError } from '../../mcp/index.js';
import { createTicketPlan } from '../../planning/repository-resolver.js';
import { createRuntimeTicketPort } from '../../providers/runtime-mcp-factory.js';
import { MarkdownReportWriter } from '../../reports/markdown-report-writer.js';
import { JsonRunStateStore, createDeliveryRunStateRecord, transitionDeliveryRunState } from '../../state/run-state-store.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

const dryRunBoundary =
  'Dry Run: planning only; no branch, OpenCode, package scripts, operation ledger, GitHub, Railway/Vercel, PR, deployment, production merge, or production deploy will run.';

export interface PlanCommandOptions {
  readonly configPath?: string;
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly now?: () => Date;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
}

export async function runPlanCommand(ticketKey: string, options: PlanCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? (() => new Date());
  let config: WorkspaceConfig;
  let ticket: DeliveryTicket;

  try {
    config = await loadWorkspaceConfig(resolve(cwd, options.configPath ?? ewokbotWorkspaceConfigPath), { workspaceRoot: cwd });
    const ticketPort = await createRuntimeTicketPort({ config, ...options.runtimeMcp, requiredJiraMcpActions: ['getTicket'] });
    ticket = await ticketPort.getTicket(ticketKey);
  } catch (error) {
    options.io.stderr(formatPlanPreflightFailure(ticketKey, error));
    return 1;
  }

  const plan = createTicketPlan(ticket, config);
  const runId = createRunId(ticketKey, now());
  const createdAt = now().toISOString();
  const stateStore = new JsonRunStateStore(cwd);
  const initialState = createDeliveryRunStateRecord({
    runId,
    ticket: ticket.ref,
    targetRepositories: plan.selectedRepositories,
    timestamps: {
      createdAt,
      updatedAt: createdAt
    },
    ticketAnalysis: plan.analysis
  });
  const finalState = transitionDeliveryRunState(initialState, plan.needsHuman ? 'NEEDS_HUMAN' : 'PLANNED', createdAt);
  const reportPath = await new MarkdownReportWriter(cwd).writePlan(runId, plan);

  await stateStore.write(finalState);

  const selectedRepositoryNames = plan.selectedRepositories.map((repository) => repository.name).join(', ') || 'none';

  options.io.stdout(`${dryRunBoundary}\n`);
  options.io.stdout(`${plan.needsHuman ? 'Needs human input' : 'Planned'} ${ticket.ref.key} as ${runId}\n`);
  options.io.stdout(`Selected repositories: ${selectedRepositoryNames}\n`);
  options.io.stdout(`Human input: ${plan.needsHuman ? plan.humanReason ?? 'required' : 'not required'}\n`);
  options.io.stdout(`Report: ${reportPath}\n`);

  return plan.needsHuman ? 2 : 0;
}

function formatPlanPreflightFailure(ticketKey: string, error: unknown): string {
  const mappedError = mapMcpError(error);
  const originalMessage = error instanceof Error ? error.message : mappedError.message;
  const reason = formatPlanPreflightReason(ticketKey, mappedError.kind, originalMessage);

  return [
    `Plan preflight failed before writing run state or planning evidence: ${reason}.`,
    `Next step: fix .ewokbot/workspace.yml, Jira MCP server/client setup, tool mapping, allowlist, MCP auth/session, and ticket access, then rerun ewokbot plan ${ticketKey}.`,
    'No run state, branch, OpenCode, package script, operation ledger, GitHub, Railway/Vercel, PR, deployment, production merge, or production deploy was started.'
  ].join('\n') + '\n';
}

function formatPlanPreflightReason(ticketKey: string, kind: ReturnType<typeof mapMcpError>['kind'], message: string): string {
  switch (kind) {
    case 'tool_not_found':
      return `missing required Jira MCP tool for TicketPort.getTicket (${message})`;
    case 'allowlist':
      return `Jira MCP tool is not allowlisted for TicketPort.getTicket (${message})`;
    case 'auth':
    case 'session':
      return `unable to read Jira ticket ${ticketKey}; MCP auth/session is not ready (${message})`;
    case 'timeout':
      return `unable to read Jira ticket ${ticketKey}; MCP tool call timed out (${message})`;
    case 'provider_error':
      return `unable to read Jira ticket ${ticketKey}; check the configured MCP client/server and ticket access (${message})`;
    case 'unknown':
      return `unable to read Jira ticket ${ticketKey}; check MCP readiness (${message})`;
  }
}

function createRunId(ticketKey: string, date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.]/gu, '').replace('T', '-').replace('Z', '');
  return `${ticketKey}-${timestamp}`;
}
