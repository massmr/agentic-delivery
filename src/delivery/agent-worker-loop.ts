import type { WorkspaceConfig } from '../config/index.js';
import type { DeliveryRunStateRecord, DeliveryTicket } from '../domain/index.js';
import { assertAdapterAllowedForAction } from '../policy/index.js';
import type { TicketPort } from '../ports/index.js';
import { createWorkspaceAdapters } from '../providers/index.js';
import {
  JsonRunStateStore,
  createDeliveryRunStateRecord,
  transitionDeliveryRunState,
  type RunStateStore
} from '../state/index.js';
import { runEndToEndMockDelivery } from './end-to-end-run.js';

export type AgentWorkerTicketStatus = 'succeeded' | 'failed' | 'escalated';
export type AgentWorkerStopReason = 'idle' | 'max-cycles' | 'stop-condition' | 'aborted';

export interface AgentWorkerRetryPolicy {
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs?: number | undefined;
}

export interface AgentWorkerProcessTicketInput {
  readonly ticket: DeliveryTicket;
  readonly runId: string;
  readonly attempt: number;
}

export interface AgentWorkerProcessTicketResult {
  readonly state: DeliveryRunStateRecord;
  readonly runId: string;
}

export interface AgentWorkerTicketResult {
  readonly ticketKey: string;
  readonly status: AgentWorkerTicketStatus;
  readonly attempts: number;
  readonly runIds: readonly string[];
  readonly finalState?: DeliveryRunStateRecord | undefined;
  readonly error?: string | undefined;
}

export interface AgentWorkerLoopSummary {
  readonly cycles: number;
  readonly queued: number;
  readonly started: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly escalated: number;
  readonly retried: number;
  readonly stoppedReason: AgentWorkerStopReason;
  readonly results: readonly AgentWorkerTicketResult[];
}

export interface RunAgentWorkerLoopInput {
  readonly config: WorkspaceConfig;
  readonly rootPath?: string | undefined;
  readonly concurrencyLimit?: number | undefined;
  readonly maxCycles?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly stopWhenIdle?: boolean | undefined;
  readonly retryPolicy?: Partial<AgentWorkerRetryPolicy> | undefined;
  readonly now?: (() => Date) | undefined;
  readonly sleep?: ((durationMs: number) => Promise<void>) | undefined;
  readonly shouldStop?: (() => boolean) | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly stateStore?: RunStateStore | undefined;
  readonly ticketPort?: TicketPort | undefined;
  readonly processTicket?: ((input: AgentWorkerProcessTicketInput) => Promise<AgentWorkerProcessTicketResult>) | undefined;
}

const defaultRetryPolicy: AgentWorkerRetryPolicy = {
  maxAttempts: 2,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000
};

export async function runAgentWorkerLoop(input: RunAgentWorkerLoopInput): Promise<AgentWorkerLoopSummary> {
  assertWorkerFallbackContracts();

  const rootPath = input.rootPath ?? process.cwd();
  const now = input.now ?? (() => new Date());
  const stateStore = input.stateStore ?? new JsonRunStateStore(rootPath);
  const retryPolicy = normalizeRetryPolicy(input.retryPolicy);
  const concurrencyLimit = resolveConcurrencyLimit(input.concurrencyLimit, input.config.workspace.maxConcurrentTickets);
  const maxCycles = positiveInteger(input.maxCycles ?? 1, 'maxCycles');
  const pollIntervalMs = nonNegativeInteger(input.pollIntervalMs ?? 0, 'pollIntervalMs');
  const stopWhenIdle = input.stopWhenIdle ?? true;
  const sleep = input.sleep ?? defaultSleep;
  const ticketPort = input.ticketPort ?? createWorkspaceAdapters({ config: input.config }).jira;
  const processTicket =
    input.processTicket ??
    ((ticketInput: AgentWorkerProcessTicketInput) =>
      runEndToEndMockDelivery({
        ticketKey: ticketInput.ticket.ref.key,
        ticket: ticketInput.ticket,
        config: input.config,
        rootPath,
        runId: ticketInput.runId,
        now
      }));
  const pendingTickets: DeliveryTicket[] = [];
  const seenTicketKeys = new Set<string>();
  const results: AgentWorkerTicketResult[] = [];
  let cycles = 0;
  let stoppedReason: AgentWorkerStopReason = 'max-cycles';
  const getStopReason = (): AgentWorkerStopReason | undefined => getWorkerStopReason(input);

  while (cycles < maxCycles) {
    const stopReason = getStopReason();
    if (stopReason !== undefined) {
      stoppedReason = stopReason;
      break;
    }

    cycles += 1;

    const backlog = await ticketPort.listBacklog();

    for (const ticket of backlog) {
      if (!seenTicketKeys.has(ticket.ref.key)) {
        seenTicketKeys.add(ticket.ref.key);
        pendingTickets.push(ticket);
      }
    }

    if (pendingTickets.length === 0 && stopWhenIdle) {
      stoppedReason = 'idle';
      break;
    }

    const cycleTickets = pendingTickets.splice(0, pendingTickets.length);
    const cycle = await processTicketsWithConcurrency(cycleTickets, concurrencyLimit, getStopReason, async (ticket) => {
      const detailedTicket = await ticketPort.getTicket(ticket.ref.key);
      return processTicketWithRetry({ ticket: detailedTicket, retryPolicy, now, sleep, stateStore, processTicket, getStopReason });
    });
    results.push(...cycle.results);

    if (cycle.stoppedReason !== undefined) {
      stoppedReason = cycle.stoppedReason;
      break;
    }

    if (stopWhenIdle) {
      stoppedReason = 'idle';
      break;
    }

    if (cycles < maxCycles && pollIntervalMs > 0) {
      await sleep(pollIntervalMs);
    }
  }

  return summarizeWorkerLoop({ cycles, queued: seenTicketKeys.size, results, stoppedReason });
}

async function processTicketsWithConcurrency(
  tickets: readonly DeliveryTicket[],
  concurrencyLimit: number,
  getStopReason: () => AgentWorkerStopReason | undefined,
  processTicket: (ticket: DeliveryTicket) => Promise<AgentWorkerTicketResult>
): Promise<{ readonly results: readonly AgentWorkerTicketResult[]; readonly stoppedReason?: AgentWorkerStopReason | undefined }> {
  const results: AgentWorkerTicketResult[] = [];
  let nextIndex = 0;
  let stoppedReason: AgentWorkerStopReason | undefined;

  async function worker(): Promise<void> {
    while (nextIndex < tickets.length) {
      const stopReason = getStopReason();
      if (stopReason !== undefined) {
        stoppedReason = stopReason;
        return;
      }

      const ticket = tickets[nextIndex];
      nextIndex += 1;

      if (ticket !== undefined) {
        results.push(await processTicket(ticket));

        const postTicketStopReason = getStopReason();
        if (postTicketStopReason !== undefined) {
          stoppedReason = postTicketStopReason;
          return;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencyLimit, tickets.length) }, () => worker()));

  return { results, stoppedReason };
}

async function processTicketWithRetry(input: {
  readonly ticket: DeliveryTicket;
  readonly retryPolicy: AgentWorkerRetryPolicy;
  readonly now: () => Date;
  readonly sleep: (durationMs: number) => Promise<void>;
  readonly stateStore: RunStateStore;
  readonly processTicket: (input: AgentWorkerProcessTicketInput) => Promise<AgentWorkerProcessTicketResult>;
  readonly getStopReason: () => AgentWorkerStopReason | undefined;
}): Promise<AgentWorkerTicketResult> {
  const runIds: string[] = [];
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= input.retryPolicy.maxAttempts; attempt += 1) {
    const preAttemptStopReason = input.getStopReason();
    if (preAttemptStopReason !== undefined) {
      return createStoppedTicketResult(input.ticket, runIds, preAttemptStopReason);
    }

    const runId = createWorkerRunId(input.ticket.ref.key, input.now(), attempt);
    runIds.push(runId);
    await writeWorkerAttemptState(input.stateStore, input.ticket, runId, 'IMPLEMENTING', input.now, `Worker attempt ${attempt} started.`);

    try {
      const result = await input.processTicket({ ticket: input.ticket, runId, attempt });
      await input.stateStore.write(result.state);

      if (result.state.state === 'NEEDS_HUMAN') {
        return {
          ticketKey: input.ticket.ref.key,
          status: 'escalated',
          attempts: attempt,
          runIds,
          finalState: result.state,
          error: result.state.humanActionNeeded?.reason
        };
      }

      if (result.state.state === 'FAILED') {
        lastError = result.state.failure?.reason ?? 'Ticket processing returned FAILED state.';
      } else {
        return {
          ticketKey: input.ticket.ref.key,
          status: 'succeeded',
          attempts: attempt,
          runIds,
          finalState: result.state
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await writeWorkerAttemptState(input.stateStore, input.ticket, runId, 'FAILED', input.now, lastError);
    }

    if (attempt < input.retryPolicy.maxAttempts) {
      const preBackoffStopReason = input.getStopReason();
      if (preBackoffStopReason !== undefined) {
        return createStoppedTicketResult(input.ticket, runIds, preBackoffStopReason);
      }

      await input.sleep(calculateBackoffMs(input.retryPolicy, attempt));
    }
  }

  const escalationRunId = runIds[runIds.length - 1] ?? createWorkerRunId(input.ticket.ref.key, input.now(), input.retryPolicy.maxAttempts);
  const escalatedState = await writeWorkerAttemptState(
    input.stateStore,
    input.ticket,
    escalationRunId,
    'NEEDS_HUMAN',
    input.now,
    `Worker exhausted ${input.retryPolicy.maxAttempts} attempt(s). Last error: ${lastError ?? 'unknown failure'}.`
  );

  return {
    ticketKey: input.ticket.ref.key,
    status: 'escalated',
    attempts: input.retryPolicy.maxAttempts,
    runIds,
    finalState: escalatedState,
    error: escalatedState.humanActionNeeded?.reason
  };
}

function createStoppedTicketResult(
  ticket: DeliveryTicket,
  runIds: readonly string[],
  stopReason: AgentWorkerStopReason
): AgentWorkerTicketResult {
  return {
    ticketKey: ticket.ref.key,
    status: 'failed',
    attempts: runIds.length,
    runIds,
    error: `Worker stopped before retry could continue: ${stopReason}.`
  };
}

async function writeWorkerAttemptState(
  stateStore: RunStateStore,
  ticket: DeliveryTicket,
  runId: string,
  state: 'IMPLEMENTING' | 'FAILED' | 'NEEDS_HUMAN',
  now: () => Date,
  reason: string
): Promise<DeliveryRunStateRecord> {
  const timestamp = now().toISOString();
  const initial = createDeliveryRunStateRecord({
    runId,
    ticket: ticket.ref,
    targetRepositories: [],
    timestamps: {
      createdAt: timestamp,
      updatedAt: timestamp
    },
    ticketAnalysis: {
      ticketKey: ticket.ref.key,
      goal: ticket.summary,
      requirements: [],
      constraints: ['Worker loop mock-mode processing only; production remains human-only.'],
      risks: []
    }
  });
  const transitioned = transitionDeliveryRunState(initial, state, timestamp);
  const record: DeliveryRunStateRecord = {
    ...transitioned,
    ...(state === 'FAILED'
      ? {
          failure: {
            state: 'IMPLEMENTING' as const,
            reason,
            occurredAt: timestamp
          }
        }
      : {}),
    ...(state === 'NEEDS_HUMAN'
      ? {
          humanActionNeeded: {
            reason,
            requestedAt: timestamp
          }
        }
      : {})
  };

  await stateStore.write(record);
  return record;
}

function summarizeWorkerLoop(input: {
  readonly cycles: number;
  readonly queued: number;
  readonly results: readonly AgentWorkerTicketResult[];
  readonly stoppedReason: AgentWorkerStopReason;
}): AgentWorkerLoopSummary {
  return {
    cycles: input.cycles,
    queued: input.queued,
    started: input.results.length,
    succeeded: input.results.filter((result) => result.status === 'succeeded').length,
    failed: input.results.filter((result) => result.status === 'failed').length,
    escalated: input.results.filter((result) => result.status === 'escalated').length,
    retried: input.results.reduce((total, result) => total + Math.max(0, result.attempts - 1), 0),
    stoppedReason: input.stoppedReason,
    results: input.results
  };
}

function normalizeRetryPolicy(policy: Partial<AgentWorkerRetryPolicy> | undefined): AgentWorkerRetryPolicy {
  const maxAttempts = positiveInteger(policy?.maxAttempts ?? defaultRetryPolicy.maxAttempts, 'maxAttempts');
  const baseBackoffMs = nonNegativeInteger(policy?.baseBackoffMs ?? defaultRetryPolicy.baseBackoffMs, 'baseBackoffMs');
  const maxBackoffMs = policy?.maxBackoffMs ?? defaultRetryPolicy.maxBackoffMs;

  return {
    maxAttempts,
    baseBackoffMs,
    ...(maxBackoffMs === undefined ? {} : { maxBackoffMs: nonNegativeInteger(maxBackoffMs, 'maxBackoffMs') })
  };
}

function resolveConcurrencyLimit(requestedLimit: number | undefined, workspaceLimit: number): number {
  const configuredLimit = positiveInteger(workspaceLimit, 'concurrencyLimit');
  const requested = requestedLimit === undefined ? configuredLimit : positiveInteger(requestedLimit, 'concurrencyLimit');

  return Math.min(requested, configuredLimit);
}

function getWorkerStopReason(input: RunAgentWorkerLoopInput): AgentWorkerStopReason | undefined {
  if (input.abortSignal?.aborted === true) {
    return 'aborted';
  }

  if (input.shouldStop?.() === true) {
    return 'stop-condition';
  }

  return undefined;
}

function calculateBackoffMs(policy: AgentWorkerRetryPolicy, failedAttempt: number): number {
  const backoff = policy.baseBackoffMs * 2 ** Math.max(0, failedAttempt - 1);
  return policy.maxBackoffMs === undefined ? backoff : Math.min(backoff, policy.maxBackoffMs);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}

function createWorkerRunId(ticketKey: string, date: Date, attempt: number): string {
  const timestamp = date.toISOString().replace(/[-:.]/gu, '').replace('T', '-').replace('Z', '');
  return `${ticketKey}-${timestamp}-worker-attempt-${attempt}`;
}

function assertWorkerFallbackContracts(): void {
  assertAdapterAllowedForAction('TicketPort', 'listBacklog', 'mock');
  assertAdapterAllowedForAction('TicketPort', 'getTicket', 'mock');
  assertAdapterAllowedForAction('CodeHostPort', 'pushBranch', 'mock');
  assertAdapterAllowedForAction('QualityGateRunner', 'runRequiredGates', 'mock');
  assertAdapterAllowedForAction('DevRunnerPort', 'runOpenCode', 'mock');
}

async function defaultSleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
