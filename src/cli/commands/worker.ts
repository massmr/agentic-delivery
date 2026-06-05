import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import {
  createAgentWorkerRuntimeInfo,
  runAgentWorkerLoop,
  type AgentWorkerLoopSummary,
  type AgentWorkerRetryPolicy,
  type AgentWorkerRuntimeInfo
} from '../../delivery/index.js';
import { createRuntimeTicketPort, createRuntimeWorkspaceAdapters, createWorkspaceAdapters } from '../../providers/index.js';
import type { TicketPort } from '../../ports/index.js';
import { loadWorkspaceEnvironment } from '../../setup/index.js';
import { runWorkerRuntime, type WorkerRuntimeMode } from '../../worker/index.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

export interface WorkerCommandOptions {
  readonly configPath?: string;
  readonly concurrencyLimit?: number | undefined;
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly maxAttempts?: number | undefined;
  readonly maxBackoffMs?: number | undefined;
  readonly maxCycles?: number | undefined;
  readonly baseBackoffMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
  readonly workerMode?: WorkerRuntimeMode | undefined;
  readonly once?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface ParsedWorkerCommandOptions {
  readonly workerMode: WorkerRuntimeMode;
  readonly once?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly concurrencyLimit?: number | undefined;
  readonly maxAttempts?: number | undefined;
  readonly maxBackoffMs?: number | undefined;
  readonly maxCycles?: number | undefined;
  readonly baseBackoffMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
}

export async function runWorkerCommand(options: WorkerCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const environment = loadWorkspaceEnvironment(cwd);
  const config = await loadWorkspaceConfig(resolve(cwd, options.configPath ?? ewokbotWorkspaceConfigPath), { workspaceRoot: cwd });
  const retryPolicy = buildRetryPolicy(options);
  const runtimeInfo = createAgentWorkerRuntimeInfo(config);

  if (options.workerMode === 'start') {
    const preflightTicketPort = runtimeInfo.mode === 'mcp' ? await createWorkerStartTicketPort({ config, environment, runtimeMcp: options.runtimeMcp, dryRun: options.dryRun }) : undefined;
    const abortController = new AbortController();
    const signalHandlers = createWorkerSignalHandlers(abortController);

    try {
      const result = await runWorkerRuntime({
        config,
        rootPath: cwd,
        io: options.io,
        runtimeInfo,
        mode: 'start',
        once: options.once,
        dryRun: options.dryRun,
        concurrencyLimit: options.concurrencyLimit,
        maxCycles: options.maxCycles,
        pollIntervalMs: options.pollIntervalMs,
        retryPolicy,
        abortSignal: abortController.signal,
        createTicketPort: async () => {
          if (preflightTicketPort !== undefined) {
            return preflightTicketPort;
          }

          if (runtimeInfo.mode === 'mcp') {
            if (options.dryRun === true) {
              return createRuntimeTicketPort({ config, environment, ...options.runtimeMcp });
            }

            return (await createRuntimeWorkspaceAdapters({ config, environment, ...options.runtimeMcp })).jira;
          }

          return createWorkspaceAdapters({ config, environment }).jira;
        }
      });

      writeWorkerRuntimeInfo(options.io, runtimeInfo);
      if (result.summary !== undefined) {
        writeWorkerSummary(options.io, result.summary);
      }

      return result.exitCode;
    } finally {
      signalHandlers.dispose();
    }
  }

  const adapters =
    runtimeInfo.mode === 'mcp'
      ? await createRuntimeWorkspaceAdapters({ config, environment, ...options.runtimeMcp })
      : createWorkspaceAdapters({ config, environment });
  const summary = await runAgentWorkerLoop({
    config,
    rootPath: cwd,
    ticketPort: adapters.jira,
    concurrencyLimit: options.concurrencyLimit,
    maxCycles: options.maxCycles,
    pollIntervalMs: options.pollIntervalMs,
    retryPolicy
  });

  writeWorkerRuntimeInfo(options.io, runtimeInfo);
  writeWorkerSummary(options.io, summary);

  return summary.escalated > 0 || summary.failed > 0 ? 2 : 0;
}

async function createWorkerStartTicketPort(options: {
  readonly config: Awaited<ReturnType<typeof loadWorkspaceConfig>>;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
  readonly dryRun?: boolean | undefined;
}): Promise<TicketPort> {
  if (options.dryRun === true) {
    return createRuntimeTicketPort({ config: options.config, environment: options.environment, ...options.runtimeMcp });
  }

  return (await createRuntimeWorkspaceAdapters({ config: options.config, environment: options.environment, ...options.runtimeMcp })).jira;
}

export function parseWorkerCommandOptions(args: readonly string[]): ParsedWorkerCommandOptions {
  const parsed: {
    workerMode: WorkerRuntimeMode;
    once?: boolean | undefined;
    dryRun?: boolean | undefined;
    concurrencyLimit?: number | undefined;
    maxAttempts?: number | undefined;
    maxBackoffMs?: number | undefined;
    maxCycles?: number | undefined;
    baseBackoffMs?: number | undefined;
    pollIntervalMs?: number | undefined;
  } = { workerMode: 'legacy' };

  let optionStartIndex = 0;

  if (args[0] === 'start') {
    parsed.workerMode = 'start';
    optionStartIndex = 1;
  } else if (args[0] !== undefined && !args[0].startsWith('-')) {
    throw new Error(`Unknown worker subcommand: ${args[0]}. Use 'worker start' or legacy 'worker' options.`);
  }

  for (let index = optionStartIndex; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];

    if (flag === '--once') {
      parsed.once = true;
    } else if (flag === '--dry-run') {
      parsed.dryRun = true;
    } else if (flag === '--concurrency') {
      parsed.concurrencyLimit = parseIntegerOption(flag, value);
      index += 1;
    } else if (flag === '--max-attempts') {
      parsed.maxAttempts = parseIntegerOption(flag, value);
      index += 1;
    } else if (flag === '--max-backoff-ms') {
      parsed.maxBackoffMs = parseIntegerOption(flag, value);
      index += 1;
    } else if (flag === '--max-cycles') {
      parsed.maxCycles = parseIntegerOption(flag, value);
      index += 1;
    } else if (flag === '--base-backoff-ms') {
      parsed.baseBackoffMs = parseIntegerOption(flag, value);
      index += 1;
    } else if (flag === '--poll-interval-ms') {
      parsed.pollIntervalMs = parseIntegerOption(flag, value);
      index += 1;
    } else {
      throw new Error(`Unknown worker option: ${flag}.`);
    }
  }

  return parsed;
}

function buildRetryPolicy(options: WorkerCommandOptions): Partial<AgentWorkerRetryPolicy> | undefined {
  if (options.maxAttempts === undefined && options.baseBackoffMs === undefined && options.maxBackoffMs === undefined) {
    return undefined;
  }

  return {
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.baseBackoffMs === undefined ? {} : { baseBackoffMs: options.baseBackoffMs }),
    ...(options.maxBackoffMs === undefined ? {} : { maxBackoffMs: options.maxBackoffMs })
  };
}

function writeWorkerRuntimeInfo(io: CliProgramIO, runtimeInfo: AgentWorkerRuntimeInfo): void {
  io.stdout(`Worker Mode: ${runtimeInfo.mode}\n`);
  io.stdout(`Intake Mode: ${runtimeInfo.intakeMode}\n`);
  io.stdout(
    `Provider Modes: Jira=${runtimeInfo.providerModes.jira}, GitHub=${runtimeInfo.providerModes.github}, Railway=${runtimeInfo.providerModes.railway}\n`
  );
}

function writeWorkerSummary(io: CliProgramIO, summary: AgentWorkerLoopSummary): void {
  io.stdout('Agent worker loop completed.\n');
  io.stdout(`Stopped Reason: ${summary.stoppedReason}\n`);
  io.stdout(`Cycles: ${summary.cycles}\n`);
  io.stdout(`Queued: ${summary.queued}\n`);
  io.stdout(`Started: ${summary.started}\n`);
  io.stdout(`Succeeded: ${summary.succeeded}\n`);
  io.stdout(`Escalated: ${summary.escalated}\n`);
  io.stdout(`Retried: ${summary.retried}\n`);

  for (const result of summary.results) {
    io.stdout(`- ${result.ticketKey}: ${result.status} after ${result.attempts} attempt(s) [${result.runIds.join(', ')}]\n`);
  }
}

function createWorkerSignalHandlers(abortController: AbortController): { readonly dispose: () => void } {
  const abort = () => abortController.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);

  return {
    dispose() {
      process.off('SIGINT', abort);
      process.off('SIGTERM', abort);
    }
  };
}

function parseIntegerOption(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) {
    throw new Error(`Missing value for ${flag}.`);
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be an integer.`);
  }

  return parsed;
}
