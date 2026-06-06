import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MockOpenCodeRunner,
  OpenCodeSubprocessRunner,
  buildOpenCodeImplementationPrompt,
  createNodeOpenCodeSubprocessExecutor,
  createDeliveryRunStateRecord,
  runOpenCodeImplementation,
  type BranchRef,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type DevRunInput,
  type DevRunResult,
  type DevRunner,
  type OpenCodeSubprocessExecutor,
  type OpenCodeSubprocessExecutorInput,
  type OpenCodeSubprocessExecutorResult,
  type OpenCodeProcessSpawner,
  type RepositoryConfig,
  type RunStateStore
} from '../src/index.js';

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-opencode-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

const ticket = {
  ref: {
    provider: 'jira',
    key: 'AD-123',
    url: 'https://jira.example.test/browse/AD-123'
  },
  summary: 'Implement OpenCode runner contract',
  description: 'Add a typed prompt builder and subprocess runner for local mock execution.',
  status: 'To Do',
  priority: 'high',
  labels: ['milestone-f'],
  createdAt: '2026-06-03T10:00:00.000Z',
  updatedAt: '2026-06-03T10:00:00.000Z'
} satisfies DeliveryTicket;

const repository = {
  ref: {
    provider: 'github',
    owner: 'agentic',
    name: 'delivery-cli',
    defaultBranch: 'main',
    url: 'https://github.com/agentic/delivery-cli'
  },
  role: 'application',
  localPath: '/workspace/delivery-cli',
  branchPolicy: {
    workingBranchPrefix: 'agent',
    stagingTarget: 'develop',
    productionTarget: 'main'
  },
  qualityGates: [
    {
      name: 'typecheck',
      command: 'pnpm typecheck',
      requirement: 'required',
      workingDirectory: '/workspace/delivery-cli'
    },
    {
      name: 'coverage',
      requirement: 'optional',
      workingDirectory: '/workspace/delivery-cli'
    }
  ],
  stagingSmokeUrls: []
} satisfies RepositoryConfig;

const branch = {
  repository: repository.ref,
  name: 'agent/AD-123-opencode-runner',
  baseBranch: 'develop'
} satisfies BranchRef;

test('buildOpenCodeImplementationPrompt renders deterministic ticket, repo, branch, quality, DoD, and guardrails', () => {
  const prompt = buildOpenCodeImplementationPrompt({
    ticket,
    analysis: {
      ticketKey: ticket.ref.key,
      goal: 'Create the runner contract.',
      requirements: ['Build prompt and runner modules.', 'Capture implementation logs.'],
      constraints: ['Do not add a public CLI command.'],
      risks: ['Accidental real provider calls.']
    },
    repository,
    branch,
    definitionOfDone: ['Tests pass.', 'State captures failures.']
  });

  assert.equal(prompt, buildOpenCodeImplementationPrompt({
    ticket,
    analysis: {
      ticketKey: ticket.ref.key,
      goal: 'Create the runner contract.',
      requirements: ['Build prompt and runner modules.', 'Capture implementation logs.'],
      constraints: ['Do not add a public CLI command.'],
      risks: ['Accidental real provider calls.']
    },
    repository,
    branch,
    definitionOfDone: ['Tests pass.', 'State captures failures.']
  }));
  assert.match(prompt, /Key: AD-123/u);
  assert.match(prompt, /Owner: agentic/u);
  assert.match(prompt, /Name: delivery-cli/u);
  assert.match(prompt, /Working branch: agent\/AD-123-opencode-runner/u);
  assert.match(prompt, /REQUIRED typecheck: pnpm typecheck/u);
  assert.match(prompt, /OPTIONAL coverage: missing command/u);
  assert.match(prompt, /Tests pass\./u);
  assert.match(prompt, /Do not call real Jira, GitHub, Railway, OpenCode provider APIs/u);
  assert.match(prompt, /Do not read, request, print, or persist credentials or secrets/u);
  assert.match(prompt, /Do not push to production/u);
});

test('OpenCodeSubprocessRunner builds a safe executor contract and allowlisted env', async (t) => {
  const rootPath = await createTempRoot(t);
  const workingDirectory = join(rootPath, 'repo');
  const logPath = join(rootPath, '.ewokbot', 'runs', 'AD-123', 'run-1', 'implementation-log.md');
  const calls: OpenCodeSubprocessExecutorInput[] = [];
  const executor: OpenCodeSubprocessExecutor = async (input) => {
    calls.push(input);
    return { stdout: 'stdout-ok', stderr: 'stderr-ok', exitCode: 0 };
  };
  const secretArgs = ['--no-network', '--token', 'plain-token-value', '--api_key=abc123', '--password', 'hunter2', 'sk-test-secret'];
  const result = await new OpenCodeSubprocessRunner({ now: fixedClock(), executor }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: 'opencode',
    commandArgs: secretArgs,
    workingDirectory,
    workspaceRoot: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: logPath,
    maxAttempts: 1,
    timeoutMs: 30000,
    environment: {
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      SECRET_TOKEN: 'do-not-pass'
    },
    environmentAllowlist: ['PATH', 'HOME']
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.args, ['run', ...secretArgs, '--dir', workingDirectory, 'mock prompt']);
  assert.equal(calls[0]?.executable, 'opencode');
  assert.equal(calls[0]?.cwd, workingDirectory);
  assert.equal(calls[0]?.stdin, '');
  assert.deepEqual(calls[0]?.env, { PATH: '/usr/bin', HOME: '/tmp/home' });
  assert.equal(calls[0]?.timeoutMs, 30000);

  const log = await readFile(logPath, 'utf8');
  assert.equal(result.status, 'passed');
  assert.match(result.command, /opencode run --no-network --token \[redacted\] --api_key=\[redacted\] --password \[redacted\] \[redacted\] --dir /u);
  assert.match(result.command, /<prompt>/u);
  assert.equal(result.attempts[0]?.command, result.command);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.exitCode, 0);
  assert.match(log, /stdout-ok/u);
  assert.match(log, /stderr-ok/u);
  assert.doesNotMatch(log, /do-not-pass/u);
  assert.doesNotMatch(log, /plain-token-value/u);
  assert.doesNotMatch(log, /abc123/u);
  assert.doesNotMatch(log, /hunter2/u);
  assert.doesNotMatch(log, /sk-test-secret/u);
  assert.doesNotMatch(result.command, /plain-token-value|abc123|hunter2|sk-test-secret/u);
});

test('nodeOpenCodeSubprocessExecutor returns cancelled without spawning when already aborted', async () => {
  const abortController = new AbortController();
  abortController.abort();
  let spawnCalls = 0;
  const spawner: OpenCodeProcessSpawner = () => {
    spawnCalls += 1;
    throw new Error('pre-aborted execution should not spawn');
  };

  const result = await createNodeOpenCodeSubprocessExecutor(spawner)({
    executable: 'opencode',
    args: ['run'],
    cwd: '/tmp',
    env: {},
    stdin: 'prompt',
    abortSignal: abortController.signal
  });

  assert.equal(spawnCalls, 0);
  assert.deepEqual(result, { stdout: '', stderr: '', exitCode: null, cancelled: true });
});

test('MockOpenCodeRunner redacts secret-like command args in persisted fields and log', async (t) => {
  const rootPath = await createTempRoot(t);
  const logPath = join(rootPath, 'implementation-log.md');
  const result = await new MockOpenCodeRunner({ now: fixedClock() }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: 'opencode',
    commandArgs: ['--secret', 'plain-secret-value', '--password=super-password', 'sk-mock-secret'],
    workingDirectory: rootPath,
    workspaceRoot: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: logPath,
    maxAttempts: 1
  });

  const log = await readFile(logPath, 'utf8');
  assert.match(result.command, /--secret \[redacted\]/u);
  assert.match(result.command, /--password=\[redacted\]/u);
  assert.equal(result.attempts[0]?.command, result.command);
  assert.doesNotMatch(result.command, /plain-secret-value|super-password|sk-mock-secret/u);
  assert.doesNotMatch(log, /plain-secret-value|super-password|sk-mock-secret/u);
  assert.match(log, /\[redacted\]/u);
});

test('OpenCodeSubprocessRunner rejects working directories outside the workspace root', async (t) => {
  const rootPath = await createTempRoot(t);

  await assert.rejects(() => new OpenCodeSubprocessRunner({ now: fixedClock(), executor: async () => ({ stdout: '', stderr: '', exitCode: 0 }) }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: 'opencode',
    workingDirectory: join(rootPath, '..', 'other-repo'),
    workspaceRoot: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: join(rootPath, 'implementation-log.md'),
    maxAttempts: 1
  }), /working directory must stay inside workspace root/u);
});

test('OpenCodeSubprocessRunner records non-zero exits, retries, and redacts secret-like output', async (t) => {
  const rootPath = await createTempRoot(t);
  const logPath = join(rootPath, 'implementation-log.md');
  const executor = createSequenceExecutor([
    { stdout: 'token=first-secret', stderr: 'mock failure sk-test-secret', exitCode: 7 },
    { stdout: 'second attempt', stderr: 'still failing', exitCode: 4 }
  ]);
  const result = await new OpenCodeSubprocessRunner({ now: fixedClock(), executor }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: 'opencode',
    workingDirectory: rootPath,
    workspaceRoot: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: logPath,
    maxAttempts: 2
  });

  const log = await readFile(logPath, 'utf8');
  assert.equal(result.status, 'failed');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.exitCode, 7);
  assert.equal(result.attempts[1]?.exitCode, 4);
  assert.match(result.summary, /last exit code 4/u);
  assert.match(log, /## Attempt 1/u);
  assert.match(log, /## Attempt 2/u);
  assert.match(log, /token=\[redacted\]/u);
  assert.match(log, /\[redacted\]/u);
  assert.doesNotMatch(log, /first-secret/u);
  assert.doesNotMatch(log, /sk-test-secret/u);
});

test('OpenCodeSubprocessRunner stops retrying after timeout', async (t) => {
  const rootPath = await createTempRoot(t);
  const logPath = join(rootPath, 'implementation-log.md');
  const executor = createSequenceExecutor([{ stdout: 'slow output', stderr: '', exitCode: null, timedOut: true, signal: 'SIGTERM' }]);
  const result = await new OpenCodeSubprocessRunner({ now: fixedClock(), executor }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: 'opencode',
    workingDirectory: rootPath,
    workspaceRoot: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: logPath,
    maxAttempts: 3,
    timeoutMs: 10
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(result.status, 'timed_out');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.timedOut, true);
  assert.match(result.summary, /timed out/u);
  assert.match(await readFile(logPath, 'utf8'), /Status: TIMED_OUT/u);
});

test('OpenCodeSubprocessRunner stops retrying after cancellation', async (t) => {
  const rootPath = await createTempRoot(t);
  const logPath = join(rootPath, 'implementation-log.md');
  const executor = createSequenceExecutor([{ stdout: '', stderr: 'operator stopped run', exitCode: null, cancelled: true, signal: 'SIGTERM' }]);
  const abortController = new AbortController();
  const result = await new OpenCodeSubprocessRunner({ now: fixedClock(), executor }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: 'opencode',
    workingDirectory: rootPath,
    workspaceRoot: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: logPath,
    maxAttempts: 2,
    abortSignal: abortController.signal
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.cancelled, true);
  assert.match(await readFile(logPath, 'utf8'), /operator stopped run/u);
});

test('runOpenCodeImplementation writes IMPLEMENTING then failed state with actionable failure reason', async () => {
  const store = new MemoryRunStateStore();
  const state = createDeliveryRunStateRecord({
    runId: 'run-1',
    ticket: ticket.ref,
    targetRepositories: [repository.ref],
    timestamps: {
      createdAt: '2026-06-03T10:00:00.000Z',
      updatedAt: '2026-06-03T10:00:00.000Z'
    },
    ticketAnalysis: {
      ticketKey: ticket.ref.key,
      goal: 'Create the runner contract.',
      requirements: ['Build prompt and runner modules.'],
      constraints: ['Do not add a public CLI command.'],
      risks: ['Accidental real provider calls.']
    }
  });
  const result = await runOpenCodeImplementation({
    state,
    ticket,
    repository,
    branch,
    definitionOfDone: ['Tests pass.'],
    command: 'mock opencode',
    rootPath: '/workspace',
    stateStore: store,
    runner: new FailingDevRunner(),
    maxAttempts: 1,
    now: fixedClock()
  });

  assert.equal(store.writes.length, 2);
  assert.equal(store.writes[0]?.state, 'IMPLEMENTING');
  assert.equal(result.state, 'FAILED');
  assert.equal(result.failure?.state, 'IMPLEMENTING');
  assert.match(result.failure?.reason ?? '', /implementation-log\.md/u);
  assert.match(result.failure?.reason ?? '', /Attempt 1 failed with exit code 9|Attempt 1 failed with exit code: 9/u);
  assert.equal(result.devRuns.length, 1);
});

function createSequenceExecutor(results: readonly OpenCodeSubprocessExecutorResult[]): OpenCodeSubprocessExecutor & { readonly calls: readonly OpenCodeSubprocessExecutorInput[] } {
  const calls: OpenCodeSubprocessExecutorInput[] = [];
  const executor = (async (input: OpenCodeSubprocessExecutorInput) => {
    calls.push(input);
    return results[Math.min(calls.length - 1, results.length - 1)] ?? { stdout: '', stderr: '', exitCode: 1 };
  }) as OpenCodeSubprocessExecutor & { readonly calls: readonly OpenCodeSubprocessExecutorInput[] };

  Object.defineProperty(executor, 'calls', {
    get: () => calls
  });

  return executor;
}

function fixedClock(): () => Date {
  let offset = 0;
  const base = Date.parse('2026-06-03T10:00:00.000Z');

  return () => {
    const date = new Date(base + offset);
    offset += 1000;
    return date;
  };
}

class MemoryRunStateStore implements RunStateStore {
  readonly writes: DeliveryRunStateRecord[] = [];

  async read(): Promise<DeliveryRunStateRecord> {
    const last = this.writes[this.writes.length - 1];

    if (last === undefined) {
      throw new Error('No state has been written.');
    }

    return last;
  }

  async write(state: DeliveryRunStateRecord): Promise<void> {
    this.writes.push(state);
  }
}

class FailingDevRunner implements DevRunner {
  async run(input: DevRunInput): Promise<DevRunResult> {
    return {
      provider: 'opencode',
      ticketKey: input.ticketKey,
      runId: input.runId,
      repository: input.repository,
      branchName: input.branchName,
      baseBranch: input.baseBranch,
      command: input.command,
      workingDirectory: input.workingDirectory,
      implementationLogPath: input.implementationLogPath,
      startedAt: '2026-06-03T10:01:00.000Z',
      finishedAt: '2026-06-03T10:02:00.000Z',
      durationMs: 60000,
      attempts: [
        {
          attempt: 1,
          command: input.command,
          workingDirectory: input.workingDirectory,
          startedAt: '2026-06-03T10:01:00.000Z',
          finishedAt: '2026-06-03T10:02:00.000Z',
          durationMs: 60000,
          exitCode: 9,
          status: 'failed',
          summary: 'Attempt 1 failed with exit code 9.'
        }
      ],
      status: 'failed',
      summary: 'OpenCode implementation failed after 1 attempt(s); last exit code 9.'
    };
  }
}
