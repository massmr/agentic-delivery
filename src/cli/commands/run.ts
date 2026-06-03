import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import { runEndToEndMockDelivery } from '../../delivery/index.js';
import type { CliProgramIO } from '../program.js';

export interface RunCommandOptions {
  readonly configPath?: string;
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly now?: () => Date;
  readonly runId?: string;
}

export async function runRunCommand(ticketKey: string, options: RunCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadWorkspaceConfig(resolve(cwd, options.configPath ?? 'config/workspace.example.yml'));
  const result = await runEndToEndMockDelivery({
    ticketKey,
    config,
    rootPath: cwd,
    runId: options.runId,
    now: options.now
  });

  if (result.state.state === 'NEEDS_HUMAN') {
    options.io.stdout(`Run ${ticketKey} needs human input as ${result.runId}.\n`);
    options.io.stdout(`State: ${result.state.state}\n`);
    options.io.stdout(`Plan Report: ${result.planReportPath}\n`);
    options.io.stdout(`Reason: ${result.state.humanActionNeeded?.reason ?? 'Human input required.'}\n`);
    return 2;
  }

  options.io.stdout(`Run ${ticketKey} completed as ${result.runId}.\n`);
  options.io.stdout(`Final State: ${result.state.state}\n`);
  options.io.stdout(`Final Report: ${result.finalReportPath ?? 'n/a'}\n`);

  return 0;
}

export function parseRunCommandOptions(args: readonly string[]): { readonly ticketKey?: string; readonly runId?: string } {
  const [ticketKey, ...flags] = args;
  let runId: string | undefined;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];

    if (flag === '--run-id') {
      runId = value;
      index += 1;
    }
  }

  return { ticketKey, runId };
}
