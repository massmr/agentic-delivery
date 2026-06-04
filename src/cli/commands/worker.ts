import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import { runAgentWorkerLoop, type AgentWorkerLoopSummary, type AgentWorkerRetryPolicy } from '../../delivery/index.js';
import { createRuntimeTicketPort } from '../../providers/index.js';
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
}

export interface ParsedWorkerCommandOptions {
  readonly concurrencyLimit?: number | undefined;
  readonly maxAttempts?: number | undefined;
  readonly maxBackoffMs?: number | undefined;
  readonly maxCycles?: number | undefined;
  readonly baseBackoffMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
}

export async function runWorkerCommand(options: WorkerCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadWorkspaceConfig(resolve(cwd, options.configPath ?? 'config/workspace.example.yml'));
  const retryPolicy = buildRetryPolicy(options);
  const ticketPort = await createRuntimeTicketPort({ config, ...options.runtimeMcp });
  const summary = await runAgentWorkerLoop({
    config,
    rootPath: cwd,
    ticketPort,
    concurrencyLimit: options.concurrencyLimit,
    maxCycles: options.maxCycles,
    pollIntervalMs: options.pollIntervalMs,
    retryPolicy
  });

  writeWorkerSummary(options.io, summary);

  return summary.escalated > 0 || summary.failed > 0 ? 2 : 0;
}

export function parseWorkerCommandOptions(args: readonly string[]): ParsedWorkerCommandOptions {
  const parsed: {
    concurrencyLimit?: number | undefined;
    maxAttempts?: number | undefined;
    maxBackoffMs?: number | undefined;
    maxCycles?: number | undefined;
    baseBackoffMs?: number | undefined;
    pollIntervalMs?: number | undefined;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];

    if (flag === '--concurrency') {
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
