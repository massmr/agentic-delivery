import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/workspace-config.js';
import { MockJiraConnector } from '../../connectors/jira/mock-jira-connector.js';
import type { CliProgramIO } from '../program.js';

export interface ScanCommandOptions {
  readonly configPath?: string;
  readonly cwd?: string;
  readonly io: CliProgramIO;
}

export async function runScanCommand(options: ScanCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadWorkspaceConfig(resolve(cwd, options.configPath ?? 'config/workspace.example.yml'));
  const jira = new MockJiraConnector(config);
  const tickets = await jira.listBacklog();

  options.io.stdout(`Found ${tickets.length} mock Jira backlog tickets:\n`);

  for (const ticket of tickets) {
    options.io.stdout(`- ${ticket.ref.key} [${ticket.priority}] ${ticket.summary}\n`);
  }

  return 0;
}
