import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MarkdownReportWriter,
  MockOpenCodeRunner,
  buildProductionPullRequestBody,
  createCliProgram,
  createDeliveryRunStateRecord,
  getRunDirectoryPath,
  getRunStateFilePath,
  recordProductionPullRequestOpened,
  renderFinalReportMarkdown,
  runProductionPullRequestPreparation,
  transitionDeliveryRunState,
  type BranchRef,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type DeploymentResult,
  type DevRunInput,
  type GitHubConnector,
  type PullRequestCheckSummary,
  type PullRequestCommentInput,
  type PullRequestInput,
  type PullRequestRef,
  type QualityReport,
  type RepositoryConfig,
  type RepositoryRef,
  type RunStateStore
} from '../src/index.js';

const ticket = {
  ref: {
    provider: 'jira',
    key: 'LK-101',
    url: 'https://jira.example.test/browse/LK-101'
  },
  summary: 'Improve frontend onboarding empty state',
  description: 'Users need a clearer frontend onboarding empty state on the web app.',
  status: 'To Do',
  priority: 'medium',
  labels: ['frontend', 'ui', 'web'],
  createdAt: '2026-06-03T10:00:00.000Z',
  updatedAt: '2026-06-03T10:00:00.000Z'
} satisfies DeliveryTicket;

const repositoryRef = {
  provider: 'github',
  owner: 'agentic',
  name: 'frontend',
  defaultBranch: 'develop',
  url: 'https://github.com/agentic/frontend'
} satisfies RepositoryRef;

const repository = {
  ref: repositoryRef,
  role: 'application',
  localPath: '/workspace/frontend',
  branchPolicy: {
    workingBranchPrefix: 'agent',
    stagingTarget: 'develop',
    productionTarget: 'main'
  },
  qualityGates: [],
  stagingSmokeUrls: ['/health']
} satisfies RepositoryConfig;

const branch = {
  repository: repositoryRef,
  name: 'agent/LK-101-empty-state',
  baseBranch: 'develop',
  headSha: 'abc123'
} satisfies BranchRef;

const qualityReport = {
  status: 'passed',
  required: [
    {
      name: 'test',
      command: 'mock quality gates',
      workingDirectory: '/workspace/frontend',
      startedAt: '2026-06-03T10:01:00.000Z',
      finishedAt: '2026-06-03T10:01:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      stdoutLogPath: 'runs/LK-101/run-1/quality-logs/test.stdout.log',
      stderrLogPath: 'runs/LK-101/run-1/quality-logs/test.stderr.log',
      status: 'passed',
      summary: 'Mock local quality gates passed.'
    }
  ],
  optional: []
} satisfies QualityReport;

const developPullRequest = {
  provider: 'github',
  repositoryOwner: 'agentic',
  repositoryName: 'frontend',
  number: 101,
  title: 'LK-101 Improve frontend onboarding empty state',
  sourceBranch: branch.name,
  targetBranch: 'develop',
  url: 'https://mock-github.local/agentic/frontend/pull/101',
  status: 'open'
} satisfies PullRequestRef;

const deployment = {
  ref: {
    provider: 'railway',
    projectId: 'mock-project-agentic',
    serviceId: 'mock-service-frontend',
    deploymentId: 'mock-agentic-frontend-staging-develop-abc123',
    environment: 'staging'
  },
  status: 'success',
  branch: 'develop',
  commitSha: 'abc123',
  serviceUrl: 'https://frontend-staging.mock-railway.local',
  smokeChecks: [
    {
      url: 'https://frontend-staging.mock-railway.local/health',
      status: 'passed',
      statusCode: 200,
      summary: 'Mock smoke check passed for /health.'
    }
  ],
  startedAt: '2026-06-03T10:02:00.000Z',
  finishedAt: '2026-06-03T10:03:00.000Z',
  summary: 'Mock Railway deployment success for agentic/frontend on develop.'
} satisfies DeploymentResult;

test('production PR body includes Jira, run, repo, develop PR, staging evidence, target, risks, and human-only note', () => {
  const body = buildProductionPullRequestBody({
    ticket,
    analysis: {
      ticketKey: ticket.ref.key,
      goal: ticket.summary,
      requirements: ['Improve the empty state.'],
      constraints: ['Keep production human-only.'],
      risks: ['Visual copy could need review.']
    },
    runId: 'run-1',
    repository: repositoryRef,
    developPullRequest,
    stagingDeployment: deployment,
    sourceBranch: 'develop',
    targetBranch: 'main'
  });

  assert.match(body, /\[LK-101\]\(https:\/\/jira\.example\.test\/browse\/LK-101\)/u);
  assert.match(body, /Run ID: run-1/u);
  assert.match(body, /Repository: agentic\/frontend/u);
  assert.match(body, /Develop PR: \[#101\]/u);
  assert.match(body, /Staging Status: SUCCESS/u);
  assert.match(body, /Smoke Status: 1 passed, 0 failed, 0 skipped/u);
  assert.match(body, /Target Branch: main/u);
  assert.match(body, /Visual copy could need review/u);
  assert.match(body, /human review only/u);
  assert.match(body, /must not merge it/u);
});

test('production PR state helper idempotently stores production PR and transitions to PRODUCTION_PR_OPENED', () => {
  const state = createState('STAGING_VERIFIED');
  const first = recordProductionPullRequestOpened(state, createProductionPullRequest(201), '2026-06-03T10:04:00.000Z');
  const second = recordProductionPullRequestOpened(first, createProductionPullRequest(202), '2026-06-03T10:05:00.000Z');

  assert.equal(second.state, 'PRODUCTION_PR_OPENED');
  assert.equal(second.pullRequests.filter((pullRequest) => pullRequest.targetBranch === 'main').length, 1);
  assert.equal(second.pullRequests.find((pullRequest) => pullRequest.targetBranch === 'main')?.number, 202);
});

test('runProductionPullRequestPreparation guards state and opens main-target PR without push or merge', async () => {
  const store = new MemoryRunStateStore();
  const github = new CapturingGitHubConnector();

  await assert.rejects(
    runProductionPullRequestPreparation({
      state: createState('DEVELOP_CHECKS_PASSED'),
      ticket,
      repository,
      github,
      stateStore: store,
      now: fixedClock()
    }),
    /STAGING_VERIFIED/u
  );

  const result = await runProductionPullRequestPreparation({
    state: createState('STAGING_VERIFIED'),
    ticket,
    repository,
    github,
    stateStore: store,
    now: fixedClock()
  });

  assert.equal(result.state, 'PRODUCTION_PR_OPENED');
  assert.equal(github.openInputs.length, 1);
  assert.equal(github.openInputs[0]?.sourceBranch, 'develop');
  assert.equal(github.openInputs[0]?.targetBranch, 'main');
  assert.equal(github.createBranchCalls, 0);
  assert.equal(github.pushBranchCalls, 0);
  assert.match(github.openInputs[0]?.body ?? '', /Human-Only Production Merge/u);
});

test('MarkdownReportWriter writes final report with all major run evidence', async (t) => {
  const rootPath = await createTempRoot(t, 'agentic-final-report-');
  const writer = new MarkdownReportWriter(rootPath);
  const state = recordProductionPullRequestOpened(createState('STAGING_VERIFIED'), createProductionPullRequest(201), '2026-06-03T10:04:00.000Z');
  const relativePath = await writer.writeFinal(ticket.ref.key, 'run-1', state, {
    planReportPath: 'runs/LK-101/run-1/plan.md',
    implementationLogPath: 'runs/LK-101/run-1/implementation-log.md',
    qualityReportPath: 'runs/LK-101/run-1/quality-report.md',
    stagingReportPath: 'runs/LK-101/run-1/staging-report.md'
  });
  const body = await readFile(join(rootPath, relativePath), 'utf8');

  assert.equal(relativePath, join(getRunDirectoryPath(ticket.ref.key, 'run-1'), 'final-report.md'));
  assert.equal(body, renderFinalReportMarkdown(ticket.ref.key, 'run-1', state, {
    planReportPath: 'runs/LK-101/run-1/plan.md',
    implementationLogPath: 'runs/LK-101/run-1/implementation-log.md',
    qualityReportPath: 'runs/LK-101/run-1/quality-report.md',
    stagingReportPath: 'runs/LK-101/run-1/staging-report.md'
  }));
  assert.match(body, /Final State: PRODUCTION_PR_OPENED/u);
  assert.match(body, /Selected Repositories/u);
  assert.match(body, /Implementation Log: runs\/LK-101\/run-1\/implementation-log\.md/u);
  assert.match(body, /Quality Report: runs\/LK-101\/run-1\/quality-report\.md/u);
  assert.match(body, /Staging Report: runs\/LK-101\/run-1\/staging-report\.md/u);
  assert.match(body, /Target: main/u);
  assert.match(body, /Production merge remains human-only/u);
});

test('MockOpenCodeRunner writes deterministic implementation log and passed result without process command execution', async (t) => {
  const rootPath = await createTempRoot(t, 'agentic-mock-opencode-');
  const input = {
    ticketKey: ticket.ref.key,
    runId: 'run-1',
    repository: repositoryRef,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: 'opencode',
    workingDirectory: repository.localPath,
    prompt: 'deterministic prompt',
    implementationLogPath: join(rootPath, 'runs', ticket.ref.key, 'run-1', 'implementation-log.md'),
    maxAttempts: 2
  } satisfies DevRunInput;
  const result = await new MockOpenCodeRunner({ now: fixedClock() }).run(input);
  const log = await readFile(input.implementationLogPath, 'utf8');

  assert.equal(result.status, 'passed');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.exitCode, 0);
  assert.match(result.summary, /without shell, process, or network execution/u);
  assert.match(log, /MockOpenCodeRunner wrote this deterministic implementation log/u);
  assert.match(log, /deterministic prompt/u);
});

test('agentic run creates complete mock run folder and reaches PRODUCTION_PR_OPENED', async (t) => {
  const workspacePath = await createTempRoot(t, 'agentic-cli-run-');
  const captured = createCapturedIO();

  await mkdir(join(workspacePath, 'config'));
  await writeFile(join(workspacePath, 'config', 'workspace.yml'), workspaceConfigYaml(), 'utf8');

  const exitCode = await createCliProgram({ cwd: workspacePath, configPath: 'config/workspace.yml', io: captured.io }).run([
    'node',
    'agentic',
    'run',
    'LK-101',
    '--run-id',
    'mock-run-1'
  ]);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Final State: PRODUCTION_PR_OPENED/u);
  assert.match(captured.stdout, /Final Report: runs\/LK-101\/mock-run-1\/final-report\.md/u);
  assert.equal(captured.stderr, '');

  const runRoot = join(workspacePath, 'runs', 'LK-101', 'mock-run-1');
  const requiredFiles = ['plan.md', 'implementation-log.md', 'quality-report.md', 'staging-report.md', 'final-report.md', 'state.json'];

  for (const fileName of requiredFiles) {
    assert.equal((await stat(join(runRoot, fileName))).isFile(), true);
  }

  const state = JSON.parse(await readFile(join(workspacePath, getRunStateFilePath('LK-101', 'mock-run-1')), 'utf8')) as DeliveryRunStateRecord;
  const finalReport = await readFile(join(runRoot, 'final-report.md'), 'utf8');

  assert.equal(state.state, 'PRODUCTION_PR_OPENED');
  assert.deepEqual(state.pullRequests.map((pullRequest) => pullRequest.targetBranch).sort(), ['develop', 'main']);
  assert.equal(state.pullRequests.find((pullRequest) => pullRequest.targetBranch === 'develop')?.sourceBranch.startsWith('agent/LK-101'), true);
  assert.equal(state.pullRequests.find((pullRequest) => pullRequest.targetBranch === 'main')?.sourceBranch, 'develop');
  assert.equal(state.stagingDeployments[0]?.branch, 'develop');
  assert.match(finalReport, /Mock-Only And Human Approval Note/u);
  assert.match(finalReport, /Production merge remains human-only/u);
});

async function createTempRoot(t: TestContext, prefix: string): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

function createState(state: DeliveryRunStateRecord['state']): DeliveryRunStateRecord {
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
      requirements: ['Improve the empty state.'],
      constraints: ['Keep production human-only.'],
      risks: ['Visual copy could need review.']
    }
  });

  return {
    ...transitionDeliveryRunState(initial, state, '2026-06-03T10:00:00.000Z'),
    branches: [branch],
    pullRequests: [developPullRequest],
    stagingDeployments: [deployment],
    qualityReports: [qualityReport],
    devRuns: [
      {
        provider: 'opencode',
        ticketKey: ticket.ref.key,
        runId: 'run-1',
        repository: repositoryRef,
        branchName: branch.name,
        baseBranch: branch.baseBranch,
        command: 'opencode',
        workingDirectory: repository.localPath,
        implementationLogPath: 'runs/LK-101/run-1/implementation-log.md',
        startedAt: '2026-06-03T10:00:00.000Z',
        finishedAt: '2026-06-03T10:00:01.000Z',
        durationMs: 1000,
        attempts: [
          {
            attempt: 1,
            command: 'opencode',
            workingDirectory: repository.localPath,
            startedAt: '2026-06-03T10:00:00.000Z',
            finishedAt: '2026-06-03T10:00:01.000Z',
            durationMs: 1000,
            exitCode: 0,
            status: 'passed',
            summary: 'Mock OpenCode implementation passed without spawning a process.'
          }
        ],
        status: 'passed',
        summary: 'Mock OpenCode implementation completed successfully without shell, process, or network execution.'
      }
    ]
  };
}

function createProductionPullRequest(number: number): PullRequestRef {
  return {
    provider: 'github',
    repositoryOwner: repositoryRef.owner,
    repositoryName: repositoryRef.name,
    number,
    title: 'LK-101 Production approval',
    sourceBranch: 'develop',
    targetBranch: 'main',
    url: `https://mock-github.local/agentic/frontend/pull/${number}`,
    status: 'open'
  };
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

function workspaceConfigYaml(): string {
  return [
    'workspace:',
    '  name: test-workspace',
    '  autonomy: full_until_production_pr',
    '  staging_branch: develop',
    '  production_branch: main',
    '  max_concurrent_tickets: 1',
    'jira:',
    '  mode: mock',
    '  base_url: https://jira.example.test',
    '  project_keys:',
    '    - LK',
    'github:',
    '  mode: mock',
    '  organization: agentic',
    'railway:',
    '  mode: mock',
    '  staging_branch: develop',
    '  production_branch: main',
    'dev_runner:',
    '  provider: opencode',
    '  command: opencode',
    '  max_attempts: 2',
    'quality:',
    '  default_profile: node',
    'repos:',
    '  - name: frontend',
    '    url: https://github.com/agentic/frontend',
    '    local_path: ./frontend',
    '    default_branch: develop',
    '    production_branch: main',
    '    quality_profile: node',
    '    hints:',
    '      - frontend',
    '      - ui',
    '      - web',
    '    staging_smoke_urls:',
    '      - /health',
    ''
  ].join('\n');
}

function createCapturedIO() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout(text: string) {
        stdout += text;
      },
      stderr(text: string) {
        stderr += text;
      }
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}

class MemoryRunStateStore implements RunStateStore {
  readonly writes: DeliveryRunStateRecord[] = [];

  async read(): Promise<DeliveryRunStateRecord> {
    const latest = this.writes[this.writes.length - 1];

    if (latest === undefined) {
      throw new Error('No state has been written.');
    }

    return latest;
  }

  async write(state: DeliveryRunStateRecord): Promise<void> {
    this.writes.push(state);
  }
}

class CapturingGitHubConnector implements GitHubConnector {
  readonly openInputs: PullRequestInput[] = [];
  createBranchCalls = 0;
  pushBranchCalls = 0;

  async createBranch(): Promise<BranchRef> {
    this.createBranchCalls += 1;
    return branch;
  }

  async pushBranch(): Promise<BranchRef> {
    this.pushBranchCalls += 1;
    return branch;
  }

  async openPullRequest(input: PullRequestInput): Promise<PullRequestRef> {
    this.openInputs.push(input);
    return createProductionPullRequest(201);
  }

  async getChecks(): Promise<PullRequestCheckSummary> {
    return {
      status: 'passed',
      totalCount: 1,
      passedCount: 1,
      failedCount: 0,
      pendingCount: 0
    };
  }

  async commentOnPullRequest(_input: PullRequestCommentInput): Promise<void> {
    return undefined;
  }
}
