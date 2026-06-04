import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDeliveryRunStateRecord,
  parseWorkspaceConfig,
  runAgentWorkerLoop,
  transitionDeliveryRunState,
  type AgentWorkerProcessTicketInput,
  type DeliveryRunState,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type RunStateStore,
  type WorkspaceConfig
} from '../src/index.js';

const config = parseWorkspaceConfig(`
workspace:
  name: Agent Worker Test
  autonomy: supervised
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 2
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  mode: mock
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
repos:
  - name: frontend
    url: https://github.com/agentic/frontend
    local_path: ./worktrees/frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
`);

test('agent worker queues backlog tickets and honors the configured concurrency limit', async () => {
  const store = new MemoryRunStateStore();
  let active = 0;
  let maxActive = 0;
  const started: string[] = [];

  const summary = await runAgentWorkerLoop({
    config,
    stateStore: store,
    now: fixedClock(),
    processTicket: async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(input.ticket.ref.key);
      await Promise.resolve();
      active -= 1;

      return {
        runId: input.runId,
        state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED')
      };
    }
  });

  assert.equal(summary.stoppedReason, 'idle');
  assert.equal(summary.queued, 2);
  assert.equal(summary.started, 2);
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.escalated, 0);
  assert.equal(maxActive, 2);
  assert.deepEqual(started.sort(), ['AD-101', 'AD-102']);
  assert.equal(store.writes.filter((state) => state.state === 'IMPLEMENTING').length, 2);
  assert.equal(store.writes.filter((state) => state.state === 'PRODUCTION_PR_OPENED').length, 2);
});

test('agent worker does not let requested concurrency bypass the workspace limit', async () => {
  const store = new MemoryRunStateStore();
  let active = 0;
  let maxActive = 0;
  const cappedConfig = { ...config, workspace: { ...config.workspace, maxConcurrentTickets: 1 } } satisfies WorkspaceConfig;

  const summary = await runAgentWorkerLoop({
    config: cappedConfig,
    concurrencyLimit: 2,
    stateStore: store,
    now: fixedClock(),
    processTicket: async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;

      return {
        runId: input.runId,
        state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED')
      };
    }
  });

  assert.equal(summary.queued, 2);
  assert.equal(summary.started, 2);
  assert.equal(summary.succeeded, 2);
  assert.equal(maxActive, 1);
});

test('agent worker retries failed tickets with deterministic backoff and escalates after exhaustion', async () => {
  const store = new MemoryRunStateStore();
  const sleeps: number[] = [];
  const attempts: number[] = [];

  const summary = await runAgentWorkerLoop({
    config,
    concurrencyLimit: 1,
    stateStore: store,
    now: fixedClock(),
    retryPolicy: {
      maxAttempts: 3,
      baseBackoffMs: 25,
      maxBackoffMs: 40
    },
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
    },
    processTicket: async (input) => {
      attempts.push(input.attempt);
      return {
        runId: input.runId,
        state: createState(input.ticket, input.runId, 'FAILED', `attempt ${input.attempt} failed`)
      };
    }
  });

  assert.equal(summary.started, 2);
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.escalated, 2);
  assert.equal(summary.retried, 4);
  assert.deepEqual(sleeps, [25, 40, 25, 40]);
  assert.deepEqual(attempts, [1, 2, 3, 1, 2, 3]);
  assert.equal(store.writes.filter((state) => state.state === 'NEEDS_HUMAN').length, 2);
  assert.match(summary.results[0]?.error ?? '', /Worker exhausted 3 attempt\(s\)/u);
});

test('agent worker treats human-needed results as escalation without retrying production gates', async () => {
  const store = new MemoryRunStateStore();
  const attempts: number[] = [];

  const summary = await runAgentWorkerLoop({
    config,
    stateStore: store,
    now: fixedClock(),
    retryPolicy: {
      maxAttempts: 3,
      baseBackoffMs: 10
    },
    processTicket: async (input) => {
      attempts.push(input.attempt);
      return {
        runId: input.runId,
        state: createState(input.ticket, input.runId, 'NEEDS_HUMAN', 'Production remains human-only.')
      };
    }
  });

  assert.equal(summary.escalated, 2);
  assert.equal(summary.retried, 0);
  assert.deepEqual(attempts, [1, 1]);
  assert.equal(store.writes.filter((state) => state.state === 'NEEDS_HUMAN').length, 2);
});

test('agent worker supports safe stop conditions, max cycles, aborts, and poll sleeps without live calls', async () => {
  const stopSummary = await runAgentWorkerLoop({
    config,
    shouldStop: () => true,
    processTicket: async (input) => ({ runId: input.runId, state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED') })
  });
  assert.equal(stopSummary.stoppedReason, 'stop-condition');
  assert.equal(stopSummary.started, 0);

  const aborted = new AbortController();
  aborted.abort();
  const abortedSummary = await runAgentWorkerLoop({
    config,
    abortSignal: aborted.signal,
    processTicket: async (input) => ({ runId: input.runId, state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED') })
  });
  assert.equal(abortedSummary.stoppedReason, 'aborted');
  assert.equal(abortedSummary.started, 0);

  const pollSleeps: number[] = [];
  const maxCycleSummary = await runAgentWorkerLoop({
    config,
    maxCycles: 2,
    stopWhenIdle: false,
    pollIntervalMs: 250,
    sleep: async (durationMs) => {
      pollSleeps.push(durationMs);
    },
    processTicket: async (input) => ({ runId: input.runId, state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED') })
  });
  assert.equal(maxCycleSummary.stoppedReason, 'max-cycles');
  assert.equal(maxCycleSummary.cycles, 2);
  assert.equal(maxCycleSummary.started, 2);
  assert.deepEqual(pollSleeps, [250]);
});

test('agent worker stops taking queued tickets when abort or stop condition fires mid-cycle', async () => {
  const abort = new AbortController();
  const abortStarted: string[] = [];

  const abortSummary = await runAgentWorkerLoop({
    config,
    concurrencyLimit: 1,
    abortSignal: abort.signal,
    now: fixedClock(),
    processTicket: async (input) => {
      abortStarted.push(input.ticket.ref.key);
      abort.abort();

      return {
        runId: input.runId,
        state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED')
      };
    }
  });

  assert.equal(abortSummary.stoppedReason, 'aborted');
  assert.equal(abortSummary.started, 1);
  assert.deepEqual(abortStarted, ['AD-101']);

  let stop = false;
  const stopStarted: string[] = [];
  const stopSummary = await runAgentWorkerLoop({
    config,
    concurrencyLimit: 1,
    shouldStop: () => stop,
    now: fixedClock(),
    processTicket: async (input) => {
      stopStarted.push(input.ticket.ref.key);
      stop = true;

      return {
        runId: input.runId,
        state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED')
      };
    }
  });

  assert.equal(stopSummary.stoppedReason, 'stop-condition');
  assert.equal(stopSummary.started, 1);
  assert.deepEqual(stopStarted, ['AD-101']);
});

test('agent worker does not continue retry attempts after abort during backoff', async () => {
  const abort = new AbortController();
  const attempts: number[] = [];
  const sleeps: number[] = [];

  const summary = await runAgentWorkerLoop({
    config,
    concurrencyLimit: 1,
    abortSignal: abort.signal,
    now: fixedClock(),
    retryPolicy: {
      maxAttempts: 3,
      baseBackoffMs: 25
    },
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
      abort.abort();
    },
    processTicket: async (input) => {
      attempts.push(input.attempt);

      return {
        runId: input.runId,
        state: createState(input.ticket, input.runId, 'FAILED', `attempt ${input.attempt} failed`)
      };
    }
  });

  assert.equal(summary.stoppedReason, 'aborted');
  assert.equal(summary.started, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.escalated, 0);
  assert.equal(summary.retried, 0);
  assert.deepEqual(attempts, [1]);
  assert.deepEqual(sleeps, [25]);
  assert.match(summary.results[0]?.error ?? '', /aborted/u);
});

test('agent worker rejects unsafe limits before processing', async () => {
  await assert.rejects(
    runAgentWorkerLoop({
      config: { ...config, workspace: { ...config.workspace, maxConcurrentTickets: 0 } } satisfies WorkspaceConfig,
      processTicket: async (input) => ({ runId: input.runId, state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED') })
    }),
    /concurrencyLimit must be a positive integer/u
  );

  await assert.rejects(
    runAgentWorkerLoop({
      config,
      maxCycles: 0,
      processTicket: async (input) => ({ runId: input.runId, state: createState(input.ticket, input.runId, 'PRODUCTION_PR_OPENED') })
    }),
    /maxCycles must be a positive integer/u
  );
});

class MemoryRunStateStore implements RunStateStore {
  readonly writes: DeliveryRunStateRecord[] = [];

  async read(ticketKey: string, runId: string): Promise<DeliveryRunStateRecord> {
    const state = this.writes.find((candidate) => candidate.ticket.key === ticketKey && candidate.runId === runId);

    if (state === undefined) {
      throw new Error(`Missing state for ${ticketKey}/${runId}`);
    }

    return state;
  }

  async write(state: DeliveryRunStateRecord): Promise<void> {
    this.writes.push(state);
  }
}

function fixedClock(): () => Date {
  let ticks = 0;

  return () => {
    ticks += 1;
    return new Date(Date.UTC(2026, 5, 4, 10, 0, ticks));
  };
}

function createState(ticket: DeliveryTicket, runId: string, state: DeliveryRunState, reason?: string): DeliveryRunStateRecord {
  const timestamp = '2026-06-04T10:00:00.000Z';
  const base = createDeliveryRunStateRecord({
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
      constraints: ['Mock worker test only.'],
      risks: []
    }
  });
  const transitioned = transitionDeliveryRunState(base, state, timestamp);

  if (state === 'FAILED') {
    return {
      ...transitioned,
      failure: {
        state: 'IMPLEMENTING',
        reason: reason ?? 'failed',
        occurredAt: timestamp
      }
    };
  }

  if (state === 'NEEDS_HUMAN') {
    return {
      ...transitioned,
      humanActionNeeded: {
        reason: reason ?? 'needs human',
        requestedAt: timestamp
      }
    };
  }

  return transitioned;
}
