import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createAgentWorkerRuntimeInfo,
  createCliProgram,
  createDeliveryRunStateRecord,
  getRunStateFilePath,
  getWorkerLockPath,
  parseWorkspaceConfig,
  runWorkerRuntime,
  transitionDeliveryRunState,
  type CliProgramIO,
  type DeliveryRunState,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type TicketPort
} from '../src/index.js';

test('worker start --dry-run uses config/workspace.yml created by init', async () => {
  const rootPath = createEmptyWorkspaceRoot();
  const captured = createCapturedIO();
  const program = createCliProgram({ cwd: rootPath, io: captured.io });

  const initExitCode = await program.run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'railway'
  ]);
  assert.equal(initExitCode, 0);

  const workerExitCode = await program.run(['node', 'ewokbot', 'worker', 'start', '--dry-run']);

  assert.equal(workerExitCode, 0);
  assert.match(captured.stdout, /Created .*config\/workspace\.yml/u);
  assert.match(captured.stdout, /worker_dry_run_backlog/u);
  assert.match(captured.stdout, /AD-101/u);
  assert.match(captured.stdout, /AD-102/u);
  assert.match(captured.stdout, /No run state, provider writes, git operations, PRs, or deployments were performed/u);
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(join(rootPath, 'runs', 'AD-101')), false);
  assert.equal(existsSync(join(rootPath, 'runs', 'AD-102')), false);
  assert.equal(existsSync(getWorkerLockPath(rootPath)), false);
});

test('worker start --dry-run previews backlog without creating run state', async () => {
  const rootPath = createWorkspaceRoot(workerConfigYaml);
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: rootPath, configPath: 'config/workspace.yml', io: captured.io }).run([
    'node',
    'ewokbot',
    'worker',
    'start',
    '--dry-run'
  ]);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /worker_dry_run_backlog/u);
  assert.match(captured.stdout, /No run state, provider writes, git operations, PRs, or deployments were performed/u);
  assert.match(captured.stdout, /AD-101/u);
  assert.match(captured.stdout, /AD-102/u);
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(join(rootPath, 'runs', 'AD-101')), false);
  assert.equal(existsSync(join(rootPath, 'runs', 'AD-102')), false);
  assert.equal(existsSync(getWorkerLockPath(rootPath)), false);
});

test('worker start --once processes one mock cycle through the foreground runtime', async () => {
  const rootPath = createWorkspaceRoot(workerConfigYaml);
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: rootPath, configPath: 'config/workspace.yml', io: captured.io }).run([
    'node',
    'ewokbot',
    'worker',
    'start',
    '--once',
    '--concurrency',
    '1',
    '--max-attempts',
    '1'
  ]);

  assert.equal(exitCode, 2);
  assert.match(captured.stdout, /worker_lock_acquired/u);
  assert.match(captured.stdout, /production_boundary policy=human-only/u);
  assert.match(captured.stdout, /Worker Mode: mock/u);
  assert.match(captured.stdout, /Agent worker loop completed/u);
  assert.match(captured.stdout, /Queued: 2/u);
  assert.match(captured.stdout, /AD-101: succeeded/u);
  assert.match(captured.stdout, /AD-102: escalated/u);
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(getWorkerLockPath(rootPath)), false);
});

test('worker runtime runs bounded continuous cycles with injectable sleep', async () => {
  const rootPath = createWorkspaceRoot(workerConfigYaml);
  const config = parseWorkspaceConfig(workerConfigYaml);
  const captured = createCapturedIO();
  const sleeps: number[] = [];
  const emptyTicketPort = createMemoryTicketPort([]);

  const result = await runWorkerRuntime({
    config,
    rootPath,
    io: captured.io,
    runtimeInfo: createAgentWorkerRuntimeInfo(config),
    mode: 'start',
    maxCycles: 2,
    pollIntervalMs: 5,
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
    },
    createTicketPort: async () => emptyTicketPort
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary?.cycles, 2);
  assert.equal(result.summary?.queued, 0);
  assert.deepEqual(sleeps, [5]);
  assert.match(captured.stdout, /worker_completed stoppedReason=max-cycles cycles=2/u);
  assert.equal(existsSync(getWorkerLockPath(rootPath)), false);
});

test('worker runtime releases lock when aborted before work starts', async () => {
  const rootPath = createWorkspaceRoot(workerConfigYaml);
  const config = parseWorkspaceConfig(workerConfigYaml);
  const abortController = new AbortController();
  abortController.abort();

  const result = await runWorkerRuntime({
    config,
    rootPath,
    io: createCapturedIO().io,
    runtimeInfo: createAgentWorkerRuntimeInfo(config),
    mode: 'start',
    maxCycles: 2,
    abortSignal: abortController.signal,
    createTicketPort: async () => createMemoryTicketPort([createTicket('AD-777', 'Do not process')])
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary?.stoppedReason, 'aborted');
  assert.equal(result.summary?.started, 0);
  assert.equal(existsSync(getWorkerLockPath(rootPath)), false);
});

test('worker runtime preserves existing state and avoids duplicate restart side effects', async () => {
  const rootPath = createWorkspaceRoot(workerConfigYaml);
  const config = parseWorkspaceConfig(workerConfigYaml);
  const captured = createCapturedIO();
  const ticket = createTicket('AD-888', 'Existing production handoff');
  const existingState = createState(ticket, 'AD-888-existing', 'PRODUCTION_PR_OPENED');
  writeState(rootPath, existingState);

  const result = await runWorkerRuntime({
    config,
    rootPath,
    io: captured.io,
    runtimeInfo: createAgentWorkerRuntimeInfo(config),
    mode: 'start',
    once: true,
    createTicketPort: async () => createMemoryTicketPort([ticket])
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary?.queued, 0);
  assert.equal(result.summary?.started, 0);
  assert.match(captured.stdout, /worker_state_reused ticket=AD-888 runId=AD-888-existing state=PRODUCTION_PR_OPENED/u);
  assert.match(captured.stdout, /human production approval/u);
  assert.deepEqual(readdirSync(join(rootPath, 'runs', 'AD-888')).sort(), ['AD-888-existing']);
});

function createWorkspaceRoot(configYaml: string): string {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-worker-runtime-'));
  mkdirSync(join(rootPath, 'config'));
  writeFileSync(join(rootPath, 'config', 'workspace.yml'), configYaml, 'utf8');
  return rootPath;
}

function createEmptyWorkspaceRoot(): string {
  return mkdtempSync(join(tmpdir(), 'agentic-worker-runtime-'));
}

function createCapturedIO(): { readonly io: CliProgramIO; readonly stdout: string; readonly stderr: string } {
  const captured = { stdout: '', stderr: '' };
  return {
    get stdout() {
      return captured.stdout;
    },
    get stderr() {
      return captured.stderr;
    },
    io: {
      stdout: (text: string) => {
        captured.stdout += text;
      },
      stderr: (text: string) => {
        captured.stderr += text;
      }
    }
  };
}

function createMemoryTicketPort(tickets: readonly DeliveryTicket[]): TicketPort {
  return {
    async listBacklog() {
      return tickets;
    },
    async getTicket(key) {
      const ticket = tickets.find((candidate) => candidate.ref.key === key);
      if (ticket === undefined) {
        throw new Error(`Missing ticket ${key}`);
      }
      return ticket;
    },
    async comment() {}
  };
}

function createTicket(key: string, summary: string): DeliveryTicket {
  return {
    ref: { provider: 'jira', key, url: `https://jira.example.test/browse/${key}` },
    summary,
    description: `${summary} description`,
    status: 'To Do',
    priority: 'medium',
    labels: ['worker-runtime'],
    createdAt: '2026-06-04T10:00:00.000Z',
    updatedAt: '2026-06-04T10:00:00.000Z'
  };
}

function createState(ticket: DeliveryTicket, runId: string, state: DeliveryRunState): DeliveryRunStateRecord {
  const timestamp = '2026-06-04T10:00:00.000Z';
  return transitionDeliveryRunState(
    createDeliveryRunStateRecord({
      runId,
      ticket: ticket.ref,
      targetRepositories: [],
      timestamps: { createdAt: timestamp, updatedAt: timestamp },
      ticketAnalysis: { ticketKey: ticket.ref.key, goal: ticket.summary, requirements: [], constraints: [], risks: [] }
    }),
    state,
    timestamp
  );
}

function writeState(rootPath: string, state: DeliveryRunStateRecord): void {
  const statePath = join(rootPath, getRunStateFilePath(state.ticket.key, state.runId));
  mkdirSync(join(statePath, '..'), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

const workerConfigYaml = `
workspace:
  name: Agent Worker Runtime Test
  autonomy: supervised
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
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
`;
