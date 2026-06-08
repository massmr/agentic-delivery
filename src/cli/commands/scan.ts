import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/workspace-config.js';
import { createRuntimeTicketPort } from '../../providers/index.js';
import { loadWorkspaceEnvironment } from '../../setup/index.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

export interface ScanCommandOptions {
  readonly configPath?: string;
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
}

export async function runScanCommand(options: ScanCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveScanConfigPath(cwd, options.configPath);
  const environment = loadWorkspaceEnvironment(cwd);
  const config = await loadWorkspaceConfig(configPath, { workspaceRoot: cwd });
  const jira = await createRuntimeTicketPort({
    config,
    environment,
    requiredJiraMcpActions: ['listBacklog'],
    ...options.runtimeMcp
  });
  const tickets = await jira.listBacklog();

  options.io.stdout(`Found ${tickets.length} Jira backlog tickets:\n`);

  for (const ticket of tickets) {
    options.io.stdout(`- ${ticket.ref.key} [${ticket.priority}] ${ticket.summary}\n`);
  }

  return 0;
}

function resolveScanConfigPath(cwd: string, configPath: string | undefined): string {
  if (configPath !== undefined) {
    return resolve(cwd, configPath);
  }

  return resolve(cwd, ewokbotWorkspaceConfigPath);
}
