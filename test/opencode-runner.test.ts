import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  OpenCodeSubprocessRunner,
  buildOpenCodeImplementationPrompt,
  createDeliveryRunStateRecord,
  runOpenCodeImplementation,
  type BranchRef,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type DevRunInput,
  type DevRunResult,
  type DevRunner,
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

test('OpenCodeSubprocessRunner success mock reads stdin and logs stdout and stderr', async (t) => {
  const rootPath = await createTempRoot(t);
  const logPath = join(rootPath, 'runs', 'AD-123', 'run-1', 'implementation-log.md');
  const result = await new OpenCodeSubprocessRunner({ now: fixedClock() }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: nodeEval("process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',(chunk)=>{input+=chunk});process.stdin.on('end',()=>{console.log('stdin:'+input);console.error('stderr-ok')})"),
    workingDirectory: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: logPath,
    maxAttempts: 1
  });

  const log = await readFile(logPath, 'utf8');
  assert.equal(result.status, 'passed');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.exitCode, 0);
  assert.match(log, /stdin:mock prompt/u);
  assert.match(log, /stderr-ok/u);
});

test('OpenCodeSubprocessRunner failure mock records non-zero exit and failed result', async (t) => {
  const rootPath = await createTempRoot(t);
  const logPath = join(rootPath, 'implementation-log.md');
  const result = await new OpenCodeSubprocessRunner({ now: fixedClock() }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: nodeEval("console.error('mock failure');process.exit(7)"),
    workingDirectory: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: logPath,
    maxAttempts: 1
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.attempts[0]?.exitCode, 7);
  assert.match(result.summary, /last exit code 7/u);
  assert.match(await readFile(logPath, 'utf8'), /mock failure/u);
});

test('OpenCodeSubprocessRunner retry skeleton records multiple attempts and log sections', async (t) => {
  const rootPath = await createTempRoot(t);
  const logPath = join(rootPath, 'implementation-log.md');
  const result = await new OpenCodeSubprocessRunner({ now: fixedClock() }).run({
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: nodeEval("console.log('retry attempt');process.exit(4)"),
    workingDirectory: rootPath,
    prompt: 'mock prompt',
    implementationLogPath: logPath,
    maxAttempts: 2
  });
  const log = await readFile(logPath, 'utf8');

  assert.equal(result.status, 'failed');
  assert.equal(result.attempts.length, 2);
  assert.match(log, /## Attempt 1/u);
  assert.match(log, /## Attempt 2/u);
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
  assert.match(result.failure?.reason ?? '', /exit code: 9/u);
  assert.equal(result.devRuns.length, 1);
});

function nodeEval(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
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
