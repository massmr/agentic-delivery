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
  RuntimeMcpPolicyError,
  MockMcpClient,
  createMockMcpTool,
  defaultGitHubMcpToolNames,
  parseWorkspaceConfig,
  recordBranchCreated,
  recordBranchPushed,
  recordDevelopHandoffCommit,
  recordPullRequestOpened,
  runDevelopPullRequestHandoff,
  runRuntimeDevelopPullRequestHandoff,
  runGitCommand,
  transitionDeliveryRunState,
  type BranchRef,
  type AgentCompletionReport,
  type CoreSafetyReport,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type GitCommandInput,
  type GitCommandResult,
  type MeaningfulDiffEvidence,
  type PullRequestCheckSummary,
  type PullRequestCommentInput,
  type PullRequestRef,
  type QualityReport,
  type RepositoryConfig,
  type RepositoryRef,
  type RunStateStore,
  type TestRelevanceReport
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
      stdoutLogPath: '.ewokbot/runs/AD-123/run-1/quality-logs/typecheck.stdout.log',
      stderrLogPath: '.ewokbot/runs/AD-123/run-1/quality-logs/typecheck.stderr.log',
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
      stdoutLogPath: '.ewokbot/runs/AD-123/run-1/quality-logs/coverage.stdout.log',
      stderrLogPath: '.ewokbot/runs/AD-123/run-1/quality-logs/coverage.stderr.log',
      status: 'skipped',
      summary: 'coverage skipped: optional gate has no command configured.'
    }
  ]
} satisfies QualityReport;

const meaningfulDiff = {
  decision: 'passed',
  reason: 'Implementation changed product TypeScript files.',
  baselineChangedFiles: [],
  afterAgentChangedFiles: ['src/delivery/develop-pr-handoff.ts'],
  newChangedFiles: ['src/delivery/develop-pr-handoff.ts'],
  changedFiles: ['src/delivery/develop-pr-handoff.ts'],
  productFiles: ['src/delivery/develop-pr-handoff.ts'],
  ignoredFiles: [],
  ignoredPathPatterns: [],
  baselineDiffSummary: 'No baseline product diff.',
  afterAgentDiffSummary: 'Develop PR handoff implementation changed.',
  diffSummary: 'Develop PR handoff implementation changed.'
} satisfies MeaningfulDiffEvidence;

const agentCompletion = {
  decision: 'pass',
  reason: 'Agent reported implementation and verification complete.',
  source: 'combined',
  statusSignal: 'completed',
  summaryText: 'Implemented GitHub PR handoff flow and ran tests.',
  changedFilesMentioned: ['src/delivery/develop-pr-handoff.ts'],
  testsMentioned: true,
  knownLimitsMentioned: true,
  blockers: [],
  findings: []
} satisfies AgentCompletionReport;

const coreSafety = {
  decision: 'pass',
  reason: 'No core safety findings.',
  changedFiles: ['src/delivery/develop-pr-handoff.ts'],
  changedFileCount: 1,
  addedLineCount: 12,
  limits: {
    maxChangedFiles: 50,
    maxAddedLines: 2000
  },
  forbiddenFiles: [],
  secretFindings: [],
  limitFindings: [],
  humanReviewFindings: []
} satisfies CoreSafetyReport;

const testRelevance = {
  decision: 'pass',
  reason: 'Relevant git and GitHub tests were reported.',
  changedFiles: ['src/delivery/develop-pr-handoff.ts'],
  testsReported: ['pnpm test -- test/git-github.test.ts'],
  qualityCommands: [
    {
      name: 'typecheck',
      command: 'pnpm typecheck',
      requirement: 'required',
      status: 'passed',
      relevant: true,
      trivial: false
    }
  ],
  findings: [],
  trivialCommandPatterns: []
} satisfies TestRelevanceReport;

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

    if (input.args.join(' ') === 'diff --cached --name-only') {
      return { stdout: 'src/delivery/develop-pr-handoff.ts\n', stderr: '', exitCode: 0 };
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

test('LocalGitAdapter commits only scoped agent product files with deterministic git arguments', async () => {
  const commands: GitCommandInput[] = [];
  const adapter = new LocalGitAdapter(async (input) => {
    commands.push(input);

    if (input.args.join(' ') === 'diff --cached --name-only') {
      return { stdout: 'src/app.ts\ntest/app.test.js\n', stderr: '', exitCode: 0 };
    }

    if (input.args[0] === 'rev-parse') {
      return { stdout: 'commit123\n', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  });
  const commit = await adapter.commitScopedAgentDiff({
    repository: repositoryRef,
    localPath: '/repo',
    branch: createBranchRef('agent/AD-123-github-pr-handoff'),
    files: ['test/app.test.js', 'src/app.ts', 'src/app.ts'],
    message: '  AD-123:   Add scoped diff  '
  });

  assert.deepEqual(commands.map((command) => command.args), [
    ['reset', '--'],
    ['add', '--', 'src/app.ts', 'test/app.test.js'],
    ['diff', '--cached', '--name-only'],
    ['-c', 'user.name=Ewokbot', '-c', 'user.email=ewokbot@example.invalid', 'commit', '-m', 'AD-123: Add scoped diff'],
    ['rev-parse', 'HEAD']
  ]);
  assert.equal(commands.every((command) => command.command === 'git'), true);
  assert.equal(commit.commitSha, 'commit123');
  assert.equal(commit.branchName, 'agent/AD-123-github-pr-handoff');
  assert.equal(commit.message, 'AD-123: Add scoped diff');
  assert.deepEqual(commit.stagedFiles, ['src/app.ts', 'test/app.test.js']);
});

test('LocalGitAdapter refuses unexpected staged files after resetting and staging scoped files', async () => {
  const commands: GitCommandInput[] = [];
  const adapter = new LocalGitAdapter(async (input) => {
    commands.push(input);

    if (input.args.join(' ') === 'diff --cached --name-only') {
      return { stdout: 'src/app.ts\npackage.json\n', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  });

  await assert.rejects(
    adapter.commitScopedAgentDiff({
      repository: repositoryRef,
      localPath: '/repo',
      branch: createBranchRef('agent/AD-123-github-pr-handoff'),
      files: ['src/app.ts'],
      message: 'AD-123: Add scoped diff'
    }),
    /Scoped agent diff commit staged unexpected files/u
  );

  assert.deepEqual(commands.map((command) => command.args), [
    ['reset', '--'],
    ['add', '--', 'src/app.ts'],
    ['diff', '--cached', '--name-only']
  ]);
});

test('LocalGitAdapter refuses unsafe scoped commit file paths before staging', async () => {
  const commands: GitCommandInput[] = [];
  const adapter = new LocalGitAdapter(async (input) => {
    commands.push(input);
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  await assert.rejects(
    adapter.commitScopedAgentDiff({
      repository: repositoryRef,
      localPath: '/repo',
      branch: createBranchRef('agent/AD-123-github-pr-handoff'),
      files: ['src/app.ts', '../secret.txt'],
      message: 'AD-123: Add scoped diff'
    }),
    /Unsafe scoped git file path/u
  );

  assert.deepEqual(commands, []);
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

test('buildDevelopPullRequestBody includes Jira, run, branch, quality, evidence, risks, and local-only note', () => {
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
    handoffCommit: {
      repository: repositoryRef,
      branchName: 'agent/AD-123-github-pr-handoff',
      commitSha: 'commit123',
      message: 'AD-123: Add GitHub PR handoff flow',
      stagedFiles: ['src/delivery/develop-pr-handoff.ts']
    },
    qualityReport,
    meaningfulDiff,
    coreSafety,
    testRelevance
  });

  assert.match(body, /\[AD-123\]\(https:\/\/jira\.example\.test\/browse\/AD-123\)/u);
  assert.match(body, /Run ID: run-1/u);
  assert.match(body, /Branch: agent\/AD-123-github-pr-handoff/u);
  assert.match(body, /Scoped Agent Diff Commit: commit123/u);
  assert.match(body, /Scoped Agent Diff Files: src\/delivery\/develop-pr-handoff\.ts/u);
  assert.match(body, /Status: PASSED/u);
  assert.match(body, /typecheck: PASSED - typecheck passed\./u);
  assert.match(body, /coverage: SKIPPED - coverage skipped/u);
  assert.match(body, /Meaningful Diff: PASSED - Implementation changed product TypeScript files/u);
  assert.match(body, /Core Safety: PASS - No core safety findings/u);
  assert.match(body, /Test Relevance: PASS - Relevant git and GitHub tests were reported/u);
  assert.match(body, /Mock behavior could drift/u);
  assert.match(body, /pushes with the local git\/native fallback/u);
  assert.match(body, /uses typed CodeHostPort operations for GitHub handoff/u);
  assert.match(body, /No production PR, merge, deployment, production branch push/u);
});

test('state helpers idempotently replace matching branch and PR entries while transitioning', () => {
  const initial = createState('PLANNED');
  const branch = createBranchRef('agent/AD-123-github-pr-handoff');
  const firstBranchState = recordBranchCreated(initial, branch, '2026-06-03T10:01:00.000Z');
  const committedBranchState = recordDevelopHandoffCommit(firstBranchState, {
    repository: repositoryRef,
    branchName: branch.name,
    commitSha: 'commit123',
    message: 'AD-123: Add GitHub PR handoff flow',
    stagedFiles: ['src/delivery/develop-pr-handoff.ts']
  }, '2026-06-03T10:02:00.000Z');
  const pushedBranchState = recordBranchPushed(committedBranchState, { ...branch, headSha: 'def456' }, '2026-06-03T10:03:00.000Z');
  const pullRequest = createPullRequest('agent/AD-123-github-pr-handoff', 12);
  const firstPrState = recordPullRequestOpened(pushedBranchState, pullRequest, '2026-06-03T10:04:00.000Z');
  const replacedPrState = recordPullRequestOpened(firstPrState, { ...pullRequest, number: 13 }, '2026-06-03T10:05:00.000Z');

  assert.equal(committedBranchState.state, 'BRANCH_CREATED');
  assert.equal(committedBranchState.developHandoffCommit?.commitSha, 'commit123');
  assert.equal(committedBranchState.branches[0]?.headSha, 'commit123');
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

  assert.deepEqual(store.writes.map((write) => write.state), ['BRANCH_CREATED', 'BRANCH_CREATED', 'PUSHED', 'PR_TO_DEVELOP_OPENED', 'DEVELOP_CHECKS_PASSED']);
  assert.deepEqual(commands.map((command) => command.args[0]), ['show-ref', 'checkout', 'rev-parse', 'reset', 'add', 'diff', '-c', 'rev-parse', 'push', 'rev-parse']);
  assert.deepEqual(commands.find((command) => command.args[0] === 'add')?.args, ['add', '--', 'src/delivery/develop-pr-handoff.ts']);
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
  assert.equal(result.developHandoffCommit?.commitSha, 'abc123');
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
  assert.deepEqual(commands.map((command) => command.args).filter((args) => args[0] === 'add'), [
    ['add', '--', 'src/delivery/develop-pr-handoff.ts']
  ]);
  assert.equal(getOperationLedgerFilePath(ticket.ref.key, 'run-1'), '.ewokbot/runs/AD-123/run-1/operation-ledger.json');
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
  assert.equal(commands.filter((command) => command.args[0] === 'add').length, 1);
  assert.equal(commands.filter((command) => command.args[0] === '-c').length, 1);
  assert.equal(commands.filter((command) => command.args[0] === 'push').length, 1);
  assert.deepEqual((await ledger.listOperations()).filter((record) => record.status === 'succeeded').map((record) => `${record.provider}:${record.port}.${record.action}`).sort(), [
    'git:LocalGitAdapter.commitScopedAgentDiff',
    'git:LocalGitAdapter.pushBranch',
    'github:CodeHostPort.commentOnPullRequest',
    'github:CodeHostPort.createBranch',
    'github:CodeHostPort.getChecks',
    'github:CodeHostPort.openPullRequest'
  ]);
});

test('runDevelopPullRequestHandoff refuses a ledgered scoped commit when local HEAD drifted', async () => {
  const store = new MemoryRunStateStore();
  const commands: GitCommandInput[] = [];
  const connector = new CountingGitHubConnector();
  const ledger = new InMemoryOperationLedger();
  const state = createState('LOCAL_CHECKS_PASSED', [qualityReport]);
  let revParseCalls = 0;
  const commandRunner = createSuccessfulGitCommandRunner(commands, {
    revParse: () => {
      revParseCalls += 1;
      return revParseCalls === 5 ? 'base456' : 'abc123';
    }
  });
  const input = {
    state,
    ticket,
    repository,
    branchName: 'agent/AD-123-github-pr-handoff',
    git: new LocalGitAdapter(commandRunner),
    github: connector,
    operationLedger: ledger,
    stateStore: store,
    now: fixedClock()
  };

  await runDevelopPullRequestHandoff(input);
  await assert.rejects(runDevelopPullRequestHandoff(input), /not the current local HEAD/u);

  assert.equal(commands.filter((command) => command.args[0] === 'add').length, 1);
  assert.equal(commands.filter((command) => command.args[0] === '-c').length, 1);
  assert.equal(commands.filter((command) => command.args[0] === 'push').length, 1);
  assert.equal(connector.pullRequestCount, 1);
});

test('runDevelopPullRequestHandoff redacts secret-like values from scoped commit messages', async () => {
  const commands: GitCommandInput[] = [];

  await runDevelopPullRequestHandoff({
    state: createState('LOCAL_CHECKS_PASSED', [qualityReport]),
    ticket: {
      ...ticket,
      summary: 'Add API token OPENAI_API_KEY=sk-secret123456'
    },
    repository,
    branchName: 'agent/AD-123-github-pr-handoff',
    git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
    github: new CountingGitHubConnector(),
    stateStore: new MemoryRunStateStore(),
    now: fixedClock()
  });

  const commitMessage = commands.find((command) => command.args[0] === '-c')?.args.at(-1);
  assert.equal(commitMessage, 'AD-123: Add API token OPENAI_API_KEY=[redacted]');
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
  assert.equal(commands.filter((command) => command.args[0] === 'add').length, 1);
  assert.equal(commands.filter((command) => command.args[0] === '-c').length, 1);
  assert.equal(commands.filter((command) => command.args[0] === 'push').length, 1);
});

test('runDevelopPullRequestHandoff blocks before side effects when quality failed', async () => {
  const store = new MemoryRunStateStore();
  const connector = new CountingGitHubConnector();
  const commands: GitCommandInput[] = [];
  const ledger = new InMemoryOperationLedger();
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
      git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
      github: connector,
      operationLedger: ledger,
      stateStore: store,
      now: fixedClock()
    }),
    /latest required quality report to pass/u
  );

  assert.deepEqual(store.writes.map((write) => write.state), []);
  assert.deepEqual(commands, []);
  assert.deepEqual(await ledger.listOperations(), []);
  assert.equal(connector.createBranchCount, 0);
  assert.equal(connector.pushCount, 0);
  assert.equal(connector.pullRequestCount, 0);
  assert.equal(connector.commentCount, 0);
  assert.equal(connector.checkCount, 0);
});

test('runDevelopPullRequestHandoff requires BA local evidence before side effects', async () => {
  const cases: readonly {
    readonly name: string;
    readonly state: DeliveryRunStateRecord;
    readonly message: RegExp;
  }[] = [
    {
      name: 'missing meaningful diff',
      state: createState('LOCAL_CHECKS_PASSED', [qualityReport], { meaningfulDiff: null }),
      message: /meaningful diff evidence to pass/u
    },
    {
      name: 'failed meaningful diff',
      state: createState('LOCAL_CHECKS_PASSED', [qualityReport], { meaningfulDiff: { ...meaningfulDiff, decision: 'failed', reason: 'Only documentation changed.' } }),
      message: /meaningful diff evidence to pass/u
    },
    {
      name: 'missing agent completion',
      state: createState('LOCAL_CHECKS_PASSED', [qualityReport], { agentCompletion: null }),
      message: /agent completion evidence to pass/u
    },
    {
      name: 'failed core safety',
      state: createState('LOCAL_CHECKS_PASSED', [qualityReport], { coreSafety: { ...coreSafety, decision: 'fail', reason: 'Secret-like diff found.' } }),
      message: /core safety evidence to pass/u
    },
    {
      name: 'warn test relevance',
      state: createState('LOCAL_CHECKS_PASSED', [qualityReport], { testRelevance: { ...testRelevance, decision: 'warn', reason: 'Only trivial tests were reported.' } }),
      message: /test relevance evidence to pass/u
    }
  ];

  for (const testCase of cases) {
    const store = new MemoryRunStateStore();
    const connector = new CountingGitHubConnector();
    const commands: GitCommandInput[] = [];
    const ledger = new InMemoryOperationLedger();

    await assert.rejects(
      runDevelopPullRequestHandoff({
        state: testCase.state,
        ticket,
        repository,
        branchName: 'agent/AD-123-github-pr-handoff',
        git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
        github: connector,
        operationLedger: ledger,
        stateStore: store,
        now: fixedClock()
      }),
      testCase.message,
      testCase.name
    );

    assert.deepEqual(store.writes, [], testCase.name);
    assert.deepEqual(commands, [], testCase.name);
    assert.deepEqual(await ledger.listOperations(), [], testCase.name);
    assert.equal(connector.createBranchCount, 0, testCase.name);
    assert.equal(connector.pullRequestCount, 0, testCase.name);
  }
});

test('runRuntimeDevelopPullRequestHandoff blocks denied create_pull_request before handoff side effects', async () => {
  const config = parseWorkspaceConfig(githubMcpWorkspaceConfig(`mcp_policy:
  mode: read_only
`));
  const client = new MockMcpClient([
    createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, () => ({ content: {}, isError: false }))
  ]);
  const state = createState('LOCAL_CHECKS_PASSED', [qualityReport]);
  const store = new MemoryRunStateStore();
  const ledger = new InMemoryOperationLedger();
  const commands: GitCommandInput[] = [];

  await assert.rejects(
    runRuntimeDevelopPullRequestHandoff({
      state,
      ticket,
      repository,
      branchName: 'agent/ad-123-runtime-policy',
      git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
      operationLedger: ledger,
      stateStore: store,
      runtimeProviders: {
        config,
        mcpClients: { github: client }
      },
      now: fixedClock()
    }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeMcpPolicyError);
      assert.equal(error.toolName, defaultGitHubMcpToolNames.openPullRequest);
      assert.equal(error.decision, 'deny');
      assert.match(error.message, /Develop PR handoff is allowed after local evidence/u);
      return true;
    }
  );

  assert.deepEqual(client.listToolRequests, [{ serverId: 'github' }]);
  assert.deepEqual(client.toolCallRequests, []);
  assert.deepEqual(commands, []);
  assert.deepEqual(store.writes, []);
  assert.deepEqual(await ledger.listOperations(), []);
});

test('runRuntimeDevelopPullRequestHandoff validates evidence before GitHub MCP policy readiness', async () => {
  const config = parseWorkspaceConfig(githubMcpWorkspaceConfig(`mcp_policy:
  mode: read_only
`));
  const client = new MockMcpClient([
    createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, () => ({ content: {}, isError: false }))
  ]);
  const store = new MemoryRunStateStore();
  const ledger = new InMemoryOperationLedger();
  const commands: GitCommandInput[] = [];

  await assert.rejects(
    runRuntimeDevelopPullRequestHandoff({
      state: createState('LOCAL_CHECKS_PASSED', [qualityReport], { testRelevance: null }),
      ticket,
      repository,
      branchName: 'agent/ad-123-runtime-policy',
      git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
      operationLedger: ledger,
      stateStore: store,
      runtimeProviders: {
        config,
        mcpClients: { github: client }
      },
      now: fixedClock()
    }),
    /test relevance evidence to pass/u
  );

  assert.deepEqual(client.listToolRequests, []);
  assert.deepEqual(client.toolCallRequests, []);
  assert.deepEqual(commands, []);
  assert.deepEqual(store.writes, []);
  assert.deepEqual(await ledger.listOperations(), []);
});

test('runRuntimeDevelopPullRequestHandoff keeps mock GitHub mode working without MCP readiness', async () => {
  const config = parseWorkspaceConfig(mockGithubWorkspaceConfig());
  const commands: GitCommandInput[] = [];
  const result = await runRuntimeDevelopPullRequestHandoff({
    state: createState('LOCAL_CHECKS_PASSED', [qualityReport]),
    ticket,
    repository,
    branchName: 'agent/ad-123-runtime-mock',
    git: new LocalGitAdapter(createSuccessfulGitCommandRunner(commands)),
    stateStore: new MemoryRunStateStore(),
    runtimeProviders: {
      config,
      createMcpClient: () => {
        throw new Error('mock GitHub mode must not construct MCP clients');
      }
    },
    now: fixedClock()
  });

  assert.equal(result.state, 'DEVELOP_CHECKS_PASSED');
  assert.deepEqual(commands.map((command) => command.args[0]), ['show-ref', 'checkout', 'rev-parse', 'reset', 'add', 'diff', '-c', 'rev-parse', 'push', 'rev-parse']);
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

interface CreateStateOptions {
  readonly meaningfulDiff?: MeaningfulDiffEvidence | null | undefined;
  readonly agentCompletion?: AgentCompletionReport | null | undefined;
  readonly coreSafety?: CoreSafetyReport | null | undefined;
  readonly testRelevance?: TestRelevanceReport | null | undefined;
}

function createState(state: DeliveryRunStateRecord['state'], qualityReports: readonly QualityReport[] = [], options: CreateStateOptions = {}): DeliveryRunStateRecord {
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
    qualityReports,
    meaningfulDiff: options.meaningfulDiff === undefined ? meaningfulDiff : options.meaningfulDiff ?? undefined,
    agentCompletion: options.agentCompletion === undefined ? agentCompletion : options.agentCompletion ?? undefined,
    coreSafety: options.coreSafety === undefined ? coreSafety : options.coreSafety ?? undefined,
    testRelevance: options.testRelevance === undefined ? testRelevance : options.testRelevance ?? undefined
  };
}

function githubMcpWorkspaceConfig(policyBlock: string): string {
  return `
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
github:
  mode: mcp
  organization: agentic
  mcp_server: github
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 1
quality:
  default_profile: node
${policyBlock}mcp_servers:
  github:
    display_name: GitHub MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.example.test/github
repos:
  - name: delivery-cli
    url: git@github.com:agentic/delivery-cli.git
    local_path: /workspace/delivery-cli
    default_branch: develop
    production_branch: main
    staging_smoke_urls: []
    quality_profile: node
    hints:
      - delivery
`;
}

function mockGithubWorkspaceConfig(): string {
  return githubMcpWorkspaceConfig(`mcp_policy:
  mode: read_only
`).replace('mode: mcp\n  organization: agentic\n  mcp_server: github', 'mode: mock\n  organization: agentic');
}

function createSuccessfulGitCommandRunner(commands: GitCommandInput[] = [], options: { readonly revParse?: (() => string) | undefined } = {}): (input: GitCommandInput) => Promise<GitCommandResult> {
  return async (input) => {
    commands.push(input);

    if (input.args[0] === 'show-ref') {
      return { stdout: '', stderr: '', exitCode: 1 };
    }

    if (input.args.join(' ') === 'diff --cached --name-only') {
      return { stdout: 'src/delivery/develop-pr-handoff.ts\n', stderr: '', exitCode: 0 };
    }

    if (input.args[0] === 'rev-parse') {
      return { stdout: `${options.revParse?.() ?? 'abc123'}\n`, stderr: '', exitCode: 0 };
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
