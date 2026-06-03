import { loadRunStatus, renderRunStatus } from '../../status/index.js';
import type { CliProgramIO } from '../program.js';

export interface StatusCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly runId?: string;
}

export async function runStatusCommand(ticketKey: string, options: StatusCommandOptions): Promise<number> {
  try {
    const result = await loadRunStatus({ rootPath: options.cwd ?? process.cwd(), ticketKey, runId: options.runId });
    options.io.stdout(`${renderRunStatus(result.state, result.runIds)}\n`);
    return 0;
  } catch (error) {
    options.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function parseStatusCommandOptions(args: readonly string[]): { readonly ticketKey?: string; readonly runId?: string } {
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
