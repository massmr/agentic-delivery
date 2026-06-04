import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  LocalGitAdapter,
  MockGitHubConnector,
  buildDevelopPullRequestBody,
  buildWorkingBranchName,
  createDeliveryRunStateRecord,
  InMemoryOperationLedger,
  JsonOperationLedger,
  getOperationLedgerFilePath,
  recordBranchCreated,
  recordBranchPushed,
  recordPullRequestOpened,
  runDevelopPullRequestHandoff,
  runGitCommand,
  transitionDeliveryRunState,
  type BranchRef,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type GitCommandInput,
  type GitCommandResult,
  type PullRequestCheckSummary,
  type PullRequestCommentInput,
  type PullRequestRef,
  type QualityReport,
  type RepositoryConfig,
  type RepositoryRef,
  type RunStateStore
} from '../src/index.js';

const ticket = {
  ref: {
    provider: 'jira',
    key: 'AD-123',
    url: 'https://jira.example.test/browse/AD-123'
  },
  summary: 'Add GitHub PR handoff flow',
  description: 'Create local git and mock GitHub handoff interfaces.',
  status: 'To Do',
  priority: 'high',
  labels: ['milestone-g'],
  createdAt: '2026-06-03T10:00:00.000Z',
  updatedAt: '2026-06-03T10:00:00.000Z'
} satisfies DeliveryTicket;

const repositoryRef = {
  provider: 'github',
  owner: 'agentic',
  name: 'delivery-cli',
  defaultBranch: 'main',
  url: 'https://github.com/agentic/delivery-cli'
} satisfies RepositoryRef;

const repository = {
  ref: repositoryRef,
  role: 'application',
  localPath: '/workspace/delivery-cli',
  branchPolicy: {
    workingBranchPrefix: 'agent',
    stagingTarget: 'develop',
    productionTarget: 'main'
  },
  qualityGates: [],
  stagingSmokeUrls: []
} satisfies RepositoryConfig;

const qualityReport = {
  status: 'passed',
  required: [
    {
      name: 'typecheck',
      command: 'pnpm typecheck',
      workingDirectory: '/workspace/delivery-cli',
      startedAt: '2026-06-03T10:10:00.000Z',
      finishedAt: '2026-06-03T10:10:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      stdoutLogPath: 'runs/AD-123/run-1/quality-logs/typecheck.stdout.log',
      stderrLogPath: 'runs/AD-123/run-1/quality-logs/typecheck.stderr.log',
      status: 'passed',
      summary: 'typecheck passed.'
    }
  ],
  optional: [
    {
      name: 'coverage',
      workingDirectory: '/workspace/delivery-cli',
      startedAt: '2026-06-03T10:10:01.000Z',
      finishedAt: '2026-06-03T10:10:01.000Z',
      durationMs: 0,
      exitCode: null,
      stdoutLogPath: 'runs/AD-123/run-1/quality-logs/coverage.stdout.log',
      stderrLogPath: 'runs/AD-123/run-1/quality-logs/coverage.stderr.log',
      status: 'skipped',
      summary: 'coverage skipped: optional gate has no command configured.'
    }
  ]
} satisfies QualityReport;

test('buildWorkingBranchName follows deterministic agent ticket slug policy with custom prefix', () => {
  assert.equal(buildWorkingBranchName({ ticketKey: 'ad-123', summary: 'Add GitHub PR handoff flow!' }), 'agent/AD-123-add-github-pr-handoff-flow');
  assert.equal(buildWorkingBranchName({ ticketKey: 'AD-123', summary: 'One Two Three Four Five', prefix: 'bot/work' }), 'bot/work/AD-123-one-two-three-four-five');
  assert.equal(buildWorkingBranchName({ ticketKey: 'AD-123', summary: 'Symbols only !!!' }), 'agent/AD-123-symbols-only');
});

test('LocalGitAdapter uses argument-array git commands and injected command runner', async () => {
  const commands: GitCommandInput[] = [];
  const adapter = new LocalGitAdapter(async (input) => {
    commands.push(input);

    if (input.args[0] === 'show-ref') {
      return { stdout: '', stderr: '', exitCode: 1 };
    }

    if (input.args[0] === 'rev-parse') {
      return { stdout: 'abc123\n', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  });
  const branch = await adapter.createBranch({
    repository: repositoryRef,
    localPath: '/repo',
    branchName: 'agent/AD-123-github-pr-handoff',
    baseBranch: 'develop'
  });

  assert.deepEqual(commands.map((command) => command.args), [
    ['show-ref', '--verify', '--quiet', 'refs/heads/agent/AD-123-github-pr-handoff'],
    ['checkout', '-b', 'agent/AD-123-github-pr-handoff', 'develop'],
    ['rev-parse', 'HEAD']
  ]);
  assert.equal(commands.every((command) => command.command === 'git'), true);
  assert.equal(branch.headSha, 'abc123');
});

test('LocalGitAdapter pushes branches through local git fallback without real remote access', async () => {
  const commands: GitCommandInput[] = [];
  const adapter = new LocalGitAdapter(async (input) => {
    commands.push(input);

    if (input.args[0] === 'rev-parse') {
      return { stdout: 'pushed123\n', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  });
  const branch = await adapter.pushBranch({
    repository: repositoryRef,
    localPath: '/repo',
    branch: createBranchRef('agent/AD-123-github-pr-handoff')
  });

  assert.deepEqual(commands.map((command) => command.args), [
    ['push', 'origin', 'agent/AD-123-github-pr-handoff'],
    ['rev-parse', 'HEAD']
  ]);
  assert.equal(commands.every((command) => command.command === 'git'), true);
  assert.equal(branch.headSha, 'pushed123');
});

test('LocalGitAdapter creates a harmless local branch in a temporary git repository', async (t) => {
  const rootPath = await createTempRoot(t, 'agentic-git-');

  await runGit(['init'], rootPath);
  await writeFile(join(rootPath, 'README.md'), '# temp\n', 'utf8');
  await runGit(['add', 'README.md'], rootPath);
  await runGit(['-c', 'user.email=agentic@example.test', '-c', 'user.name=Agentic Test', 'commit', '-m', 'initial'], rootPath);
  await runGit(['branch', 'develop'], rootPath);

  const branch = await new LocalGitAdapter().createBranch({
    repository: repositoryRef,
    localPath: rootPath,
    branchName: 'agent/AD-123-temp-repo',
    baseBranch: 'develop'
  });
  const activeBranch = await runGit(['branch', '--show-current'], rootPath);

  assert.equal(branch.name, 'agent/AD-123-temp-repo');
  assert.equal(branch.baseBranch, 'develop');
  assert.equal(activeBranch.stdout.trim(), 'agent/AD-123-temp-repo');
});

test('MockGitHubConnector opens deterministic idempotent PR refs without real provider calls', async () => {
  const connector = new MockGitHubConnector();
  const branch = createBranchRef('agent/AD-123-github-pr-handoff');
  const first = await connector.openPullRequest({
    repository: repositoryRef,
    title: 'AD-123 Add GitHub PR handoff flow',
    body: 'mock body',
    sourceBranch: branch.name,
    targetBranch: 'develop'
  });
  const second = await connector.openPullRequest({
    repository: repositoryRef,
    title: 'AD-123 Add GitHub PR handoff flow',
    body: 'mock body updated',
    sourceBranch: branch.name,
    targetBranch: 'develop'
  });

  assert.deepEqual(second, first);
  assert.equal(first.provider, 'github');
  assert.equal(first.status, 'open');
  assert.match(first.url, /^https:\/\/mock-github\.local\/agentic\/delivery-cli\/pull\//u);
});

test('buildDevelopPullRequestBody includes Jira, run, branch, quality, risks, and local-only note', () => {
  const body = buildDevelopPullRequestBody({
    ticket,
    analysis: {
      ticketKey: ticket.ref.key,
      goal: ticket.summary,
      requirements: ['Create interfaces.'],
      constraints: ['No real GitHub calls.'],
      risks: ['Mock behavior could drift from future provider adapter.']
    },
    runId: 'run-1',
    repository: repositoryRef,
    branch: createBranchRef('agent/AD-123-github-pr-handoff'),
    qualityReport
  });

  assert.match(body, /\[AD-123\]\(https:\/\/jira\.example\.test\/browse\/AD-123\)/u);
  assert.match(body, /Run ID: run-1/u);
  assert.match(body, /Branch: agent\/AD-123-github-pr-handoff/u);
  assert.match(body, /Status: PASSED/u);
  assert.match(body, /typecheck: PASSED - typecheck passed\./u);
  assert.match(body, /coverage: SKIPPED - coverage skipped/u);
  assert.match(body, /Mock behavior could drift/u);
  assert.match(body, /local git and mock GitHub interfaces only/u);
});

test('state helpers idempotently replace matching branch and PR entries while transitioning', () => {
  const initial = createState('PLANNED');
  const branch = createBranchRef('agent/AD-123-github-pr-handoff');
  const firstBranchState = recordBranchCreated(initial, branch, '2026-06-03T10:01:00.000Z');
  const pushedBranchState = recordBranchPushed(firstBranchState, { ...branch, headSha: 'def456' }, '2026-06-03T10:02:00.000Z');
  const pullRequest = createPullRequest('agent/AD-123-github-pr-handoff', 12);
  const firstPrState = recordPullRequestOpened(pushedBranchState, pullRequest, '2026-06-03T10:03:00.000Z');
  const replacedPrState = recordPullRequestOpened(firstPrState, { ...pullRequest, number: 13 }, '2026-06-03T10:04:00.000Z');

  assert.equal(pushedBranchState.state, 'PUSHED');
  assert.equal(pushedBranchState.branches.length, 1);
  assert.equal(pushedBranchState.branches[0]?.headSha, 'def456');
  assert.equal(replacedPrState.state, 'PR_TO_DEVELOP_OPENED');
  assert.equal(replacedPrState.pullRequests.length, 1);
  assert.equal(replacedPrState.pullRequests[0]?.number, 13);
});

test('runDevelopPullRequestHandoff uses CodeHostPort actions and local push after passed local quality', async () => {
  const store = new MemoryRunStateStore();
  const commands: GitCommandInput[] = [];
  const commandRunner = createSuccessfulGitCommandRunner(commands);
  const connector = new CountingGitHubConnector();
  const state = createState('LOCAL_CHECKS_PASSED', [qualityReport]);
  const result = await runDevelopPullRequestHandoff({
    state,
    ticket,
    repository,
    branchName: 'agent/AD-123-github-pr-handoff',
    git: new LocalGitAdapter(commandRunner),
    github: connector,
    stateStore: store,
    now: fixedClock()
  });

  assert.deepEqual(store.writes.map((write) => write.state), ['BRANCH_CREATED', 'PUSHED', 'PR_TO_DEVELOP_OPENED', 'DEVELOP_CHECKS_PASSED']);
  assert.deepEqual(commands.map((command) => command.args).filter((args) => args[0] === 'push'), [
    ['push', 'origin', 'agent/AD-123-github-pr-handoff']
  ]);
  assert.equal(connector.createBranchCount, 1);
  assert.equal(connector.pushCount, 0);
  assert.equal(connector.pullRequestCount, 1);
  assert.equal(connector.commentCount, 1);
  assert.equal(connector.checkCount, 1);
  assert.equal(result.pullRequests.length, 1);
  assert.equal(result.pullRequests[0]?.targetBranch, 'develop');
  assert.equal(result.state, 'DEVELOP_CHECKS_PASSED');
});

test('runDevelopPullRequestHandoff without a ledger root ignores stale cwd ledger state', async (t) => {
  const rootPath = await createTempRoot(t, 'agentic-stale-ledger-');
  const staleLedger = new JsonOperationLedger(ticket.ref.key, 'run-1', rootPath);
  const staleStarted = await staleLedger.startOperation({
    runId: 'run-1',
    provider: 'git',
    port: 'LocalGitAdapter',
    action: 'pushBranch',
    input: { repository: repository.ref, branch: createBranchRef('agent/AD-123-github-pr-handoff') },
    startedAt: '2026-06-03T10:00:00.000Z'
  });
  await staleLedger.succeedOperation({
    operationId: staleStarted.operationId,
    finishedAt: '2026-06-03T10:00:01.000Z',
    externalId: 'agent/AD-123-github-pr-handoff',
    result: createBranchRef('agent/AD-123-github-pr-handoff')
  });

  const store = new MemoryRunStateStore();
  const commands: GitCommandInput[] = [];
  const state = createState('LOCAL_CHECKS_PASSED', [qualityReport]);
  await runDevelopPullRequestHandoff({
    state,
    ticket,
    repository,
    branchName: 'agent/AD-123-github-pr-handoff',
    git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
    github: new CountingGitHubConnector(),
    stateStore: store,
    now: fixedClock()
  });

  assert.deepEqual(commands.map((command) => command.args).filter((args) => args[0] === 'push'), [
    ['push', 'origin', 'agent/AD-123-github-pr-handoff']
  ]);
  assert.equal(getOperationLedgerFilePath(ticket.ref.key, 'run-1'), 'runs/AD-123/run-1/operation-ledger.json');
});

test('runDevelopPullRequestHandoff ledger prevents duplicate GitHub handoff side effects on rerun', async () => {
  const store = new MemoryRunStateStore();
  const commands: GitCommandInput[] = [];
  const connector = new CountingGitHubConnector();
  const ledger = new InMemoryOperationLedger();
  const state = createState('LOCAL_CHECKS_PASSED', [qualityReport]);
  const input = {
    state,
    ticket,
    repository,
    branchName: 'agent/AD-123-github-pr-handoff',
    git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
    github: connector,
    operationLedger: ledger,
    stateStore: store,
    now: fixedClock()
  };

  await runDevelopPullRequestHandoff(input);
  await runDevelopPullRequestHandoff(input);

  assert.equal(connector.createBranchCount, 1);
  assert.equal(connector.pushCount, 0);
  assert.equal(connector.pullRequestCount, 1);
  assert.equal(connector.commentCount, 1);
  assert.equal(connector.checkCount, 1);
  assert.equal(commands.filter((command) => command.args[0] === 'push').length, 1);
  assert.deepEqual((await ledger.listOperations()).filter((record) => record.status === 'succeeded').map((record) => `${record.provider}:${record.port}.${record.action}`).sort(), [
    'git:LocalGitAdapter.pushBranch',
    'github:CodeHostPort.commentOnPullRequest',
    'github:CodeHostPort.createBranch',
    'github:CodeHostPort.getChecks',
    'github:CodeHostPort.openPullRequest'
  ]);
});

test('runDevelopPullRequestHandoff uses persisted ledger state on rerun with a new ledger instance', async (t) => {
  const rootPath = await createTempRoot(t, 'agentic-json-ledger-');
  const store = new MemoryRunStateStore();
  const commands: GitCommandInput[] = [];
  const connector = new CountingGitHubConnector();
  const state = createState('LOCAL_CHECKS_PASSED', [qualityReport]);
  const input = {
    state,
    ticket,
    repository,
    branchName: 'agent/AD-123-github-pr-handoff',
    git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
    github: connector,
    stateStore: store,
    now: fixedClock()
  };

  await runDevelopPullRequestHandoff({
    ...input,
    operationLedger: new JsonOperationLedger(ticket.ref.key, state.runId, rootPath)
  });
  await runDevelopPullRequestHandoff({
    ...input,
    operationLedger: new JsonOperationLedger(ticket.ref.key, state.runId, rootPath)
  });

  assert.equal(connector.createBranchCount, 1);
  assert.equal(connector.pushCount, 0);
  assert.equal(connector.pullRequestCount, 1);
  assert.equal(connector.commentCount, 1);
  assert.equal(connector.checkCount, 1);
  assert.equal(commands.filter((command) => command.args[0] === 'push').length, 1);
});

test('runDevelopPullRequestHandoff persists BRANCH_CREATED but blocks push and PR when quality failed', async () => {
  const store = new MemoryRunStateStore();
  const connector = new CountingGitHubConnector();
  const failedQualityReport: QualityReport = {
    ...qualityReport,
    status: 'failed',
    required: [{ ...qualityReport.required[0], status: 'failed', exitCode: 1, summary: 'typecheck failed.' }]
  };
  const state = createState('LOCAL_CHECKS_PASSED', [failedQualityReport]);

  await assert.rejects(
    runDevelopPullRequestHandoff({
      state,
      ticket,
      repository,
      branchName: 'agent/AD-123-github-pr-handoff',
      git: new LocalGitAdapter(createSuccessfulGitCommandRunner()),
      github: connector,
      stateStore: store,
      now: fixedClock()
    }),
    /latest required quality report to pass/u
  );

  assert.deepEqual(store.writes.map((write) => write.state), ['BRANCH_CREATED']);
  assert.equal(connector.createBranchCount, 0);
  assert.equal(connector.pushCount, 0);
  assert.equal(connector.pullRequestCount, 0);
  assert.equal(connector.commentCount, 0);
  assert.equal(connector.checkCount, 0);
});

async function createTempRoot(t: TestContext, prefix: string): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

async function runGit(args: readonly string[], cwd: string): Promise<GitCommandResult> {
  const result = await runGitCommand({ command: 'git', args, cwd });

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }

  return result;
}

function createBranchRef(name: string): BranchRef {
  return {
    repository: repositoryRef,
    name,
    baseBranch: 'develop',
    headSha: 'abc123'
  };
}

function createPullRequest(sourceBranch: string, number: number): PullRequestRef {
  return {
    provider: 'github',
    repositoryOwner: repositoryRef.owner,
    repositoryName: repositoryRef.name,
    number,
    title: 'AD-123 Add GitHub PR handoff flow',
    sourceBranch,
    targetBranch: 'develop',
    url: `https://mock-github.local/agentic/delivery-cli/pull/${number}`,
    status: 'open'
  };
}

function createState(state: DeliveryRunStateRecord['state'], qualityReports: readonly QualityReport[] = []): DeliveryRunStateRecord {
  const initial = createDeliveryRunStateRecord({
    runId: 'run-1',
    ticket: ticket.ref,
    targetRepositories: [repositoryRef],
    timestamps: {
      createdAt: '2026-06-03T10:00:00.000Z',
      updatedAt: '2026-06-03T10:00:00.000Z'
    },
    ticketAnalysis: {
      ticketKey: ticket.ref.key,
      goal: ticket.summary,
      requirements: ['Create local git and GitHub interfaces.'],
      constraints: ['Preserve local/mock-only behavior.'],
      risks: ['Mock provider drift.']
    }
  });

  return {
    ...transitionDeliveryRunState(initial, state, '2026-06-03T10:00:00.000Z'),
    qualityReports
  };
}

function createSuccessfulGitCommandRunner(commands: GitCommandInput[] = []): (input: GitCommandInput) => Promise<GitCommandResult> {
  return async (input) => {
    commands.push(input);

    if (input.args[0] === 'show-ref') {
      return { stdout: '', stderr: '', exitCode: 1 };
    }

    if (input.args[0] === 'rev-parse') {
      return { stdout: 'abc123\n', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

function fixedClock(): () => Date {
  let offset = 0;
  const base = Date.parse('2026-06-03T10:20:00.000Z');

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

class CountingGitHubConnector extends MockGitHubConnector {
  createBranchCount = 0;
  pushCount = 0;
  pullRequestCount = 0;
  commentCount = 0;
  checkCount = 0;

  override async createBranch(input: Parameters<MockGitHubConnector['createBranch']>[0]): Promise<BranchRef> {
    this.createBranchCount += 1;
    return super.createBranch(input);
  }

  override async pushBranch(input: Parameters<MockGitHubConnector['pushBranch']>[0]): Promise<BranchRef> {
    this.pushCount += 1;
    return super.pushBranch(input);
  }

  override async openPullRequest(input: Parameters<MockGitHubConnector['openPullRequest']>[0]): Promise<PullRequestRef> {
    this.pullRequestCount += 1;
    return super.openPullRequest(input);
  }

  override async getChecks(): Promise<PullRequestCheckSummary> {
    this.checkCount += 1;
    return {
      status: 'passed',
      totalCount: 1,
      passedCount: 1,
      failedCount: 0,
      pendingCount: 0
    };
  }

  override async commentOnPullRequest(input: PullRequestCommentInput): Promise<void> {
    this.commentCount += 1;
    return super.commentOnPullRequest(input);
  }
}
