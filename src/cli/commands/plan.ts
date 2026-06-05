import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/workspace-config.js';
import { MockJiraConnector } from '../../connectors/jira/mock-jira-connector.js';
import { createTicketPlan } from '../../planning/repository-resolver.js';
import { MarkdownReportWriter } from '../../reports/markdown-report-writer.js';
import { JsonRunStateStore, createDeliveryRunStateRecord, transitionDeliveryRunState } from '../../state/run-state-store.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO } from '../program.js';

export interface PlanCommandOptions {
  readonly configPath?: string;
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly now?: () => Date;
}

export async function runPlanCommand(ticketKey: string, options: PlanCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const config = await loadWorkspaceConfig(resolve(cwd, options.configPath ?? ewokbotWorkspaceConfigPath), { workspaceRoot: cwd });
  const ticket = await new MockJiraConnector(config).getTicket(ticketKey);
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

  options.io.stdout(`${plan.needsHuman ? 'Needs human input' : 'Planned'} ${ticket.ref.key} as ${runId}\n`);
  options.io.stdout(`Report: ${reportPath}\n`);

  return plan.needsHuman ? 2 : 0;
}

function createRunId(ticketKey: string, date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.]/gu, '').replace('T', '-').replace('Z', '');
  return `${ticketKey}-${timestamp}`;
}
