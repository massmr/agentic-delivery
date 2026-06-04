import type { WorkspaceConfig } from '../config/index.js';
import type { AgentWorkerLoopSummary, AgentWorkerRetryPolicy, AgentWorkerRuntimeInfo } from '../delivery/index.js';
import { runAgentWorkerLoop } from '../delivery/index.js';
import type { TicketPort } from '../ports/index.js';
import { acquireWorkerLock, WorkerLockHeldError } from './worker-lock.js';
import { createWorkerLogger } from './worker-logger.js';
import { createStateAwareTicketPort } from './worker-state-reuse.js';

export type WorkerRuntimeMode = 'legacy' | 'start';

export interface WorkerRuntimeOptions {
  readonly config: WorkspaceConfig;
  readonly rootPath: string;
  readonly io: { readonly stdout: (text: string) => void; readonly stderr: (text: string) => void };
  readonly runtimeInfo: AgentWorkerRuntimeInfo;
  readonly createTicketPort: () => Promise<TicketPort>;
  readonly mode: WorkerRuntimeMode;
  readonly dryRun?: boolean | undefined;
  readonly once?: boolean | undefined;
  readonly concurrencyLimit?: number | undefined;
  readonly maxCycles?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly retryPolicy?: Partial<AgentWorkerRetryPolicy> | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly sleep?: ((durationMs: number) => Promise<void>) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly isProcessAlive?: ((pid: number) => boolean) | undefined;
}

export interface WorkerRuntimeResult {
  readonly exitCode: number;
  readonly summary?: AgentWorkerLoopSummary | undefined;
}

const continuousMaxCycles = Number.MAX_SAFE_INTEGER;
const defaultContinuousPollIntervalMs = 60000;

export async function runWorkerRuntime(options: WorkerRuntimeOptions): Promise<WorkerRuntimeResult> {
  const logger = createWorkerLogger({ io: options.io, now: options.now });
  let staleRecovered = false;

  logger.log('info', 'worker_starting', {
    command: options.mode === 'start' ? 'worker start' : 'worker',
    mode: options.runtimeInfo.mode,
    intake: options.runtimeInfo.intakeMode,
    dryRun: options.dryRun === true,
    once: options.once === true,
    workspace: options.rootPath
  });
  logger.log('info', 'production_boundary', { policy: 'human-only' });

  let lease;
  try {
    lease = await acquireWorkerLock({
      rootPath: options.rootPath,
      now: options.now,
      isProcessAlive: options.isProcessAlive,
      onStaleLockRecovered: (metadata) => {
        staleRecovered = true;
        logger.log('warn', 'worker_lock_stale_recovered', { pid: metadata?.pid });
      }
    });
  } catch (error) {
    if (error instanceof WorkerLockHeldError) {
      options.io.stderr(`${error.message}\n`);
      return { exitCode: 2 };
    }

    throw error;
  }

  logger.log('info', 'worker_lock_acquired', { lockPath: lease.lockPath, pid: lease.metadata.pid, staleRecovered });

  try {
    const ticketPort = await options.createTicketPort();

    if (options.dryRun === true) {
      const backlog = await ticketPort.listBacklog();
      logger.log('info', 'worker_dry_run_backlog', { queued: backlog.length });
      options.io.stdout('Worker dry run completed. No run state, provider writes, git operations, PRs, or deployments were performed.\n');
      for (const ticket of backlog) {
        options.io.stdout(`- ${ticket.ref.key}: ${ticket.summary}\n`);
      }
      return { exitCode: 0 };
    }

    const stateAware = createStateAwareTicketPort({ rootPath: options.rootPath, ticketPort });
    const maxCycles = resolveRuntimeMaxCycles(options);
    const pollIntervalMs = resolveRuntimePollInterval(options);
    const stopWhenIdle = options.mode === 'legacy' || options.once === true;
    const summary = await runAgentWorkerLoop({
      config: options.config,
      rootPath: options.rootPath,
      ticketPort: stateAware.ticketPort,
      concurrencyLimit: options.concurrencyLimit,
      maxCycles,
      pollIntervalMs,
      stopWhenIdle,
      retryPolicy: options.retryPolicy,
      abortSignal: options.abortSignal,
      sleep: options.sleep
    });

    for (const decision of stateAware.skippedTickets) {
      logger.log('warn', 'worker_state_reused', {
        ticket: decision.ticketKey,
        runId: decision.runId,
        state: decision.state,
        nextAction: decision.nextAction
      });
    }

    logger.log('info', 'worker_completed', {
      stoppedReason: summary.stoppedReason,
      cycles: summary.cycles,
      queued: summary.queued,
      started: summary.started,
      succeeded: summary.succeeded,
      escalated: summary.escalated,
      failed: summary.failed
    });

    return { exitCode: summary.escalated > 0 || summary.failed > 0 ? 2 : 0, summary };
  } finally {
    await lease.release();
    logger.log('info', 'worker_lock_released', { lockPath: lease.lockPath });
  }
}

function resolveRuntimeMaxCycles(options: WorkerRuntimeOptions): number {
  if (options.maxCycles !== undefined) {
    return options.maxCycles;
  }

  if (options.mode === 'legacy' || options.once === true) {
    return 1;
  }

  return continuousMaxCycles;
}

function resolveRuntimePollInterval(options: WorkerRuntimeOptions): number {
  if (options.pollIntervalMs !== undefined) {
    return options.pollIntervalMs;
  }

  if (options.mode === 'start' && options.once !== true) {
    return defaultContinuousPollIntervalMs;
  }

  return 0;
}
