import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MockMcpClient,
  createCliProgram,
  createMockMcpTool,
  defaultGitHubMcpToolNames,
  defaultJiraMcpToolNames,
  defaultRailwayMcpToolNames,
  getOperationLedgerFilePath,
  getRunDirectoryPath,
  getRunStateFilePath,
  type CliProgramIO,
  type DeliveryRunStateRecord,
  type DevRunInput,
  type DevRunResult,
  type DevRunner,
  type GitCommandInput,
  type GitCommandResult,
  type JsonObject,
  type QualityReport
} from '../src/index.js';

test('run-dev command refuses missing confirmation before config, MCP, state, or git', async (t) => {
  const rootPath = await createTempRoot(t);
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /missing --confirm-dev-execution/u);
  assert.deepEqual(clients.atlassian.listToolRequests, []);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs')));
});

test('run-dev command executes one selected repository through local checks only', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner();
  const qualityReport = createPassedQualityReport(join(rootPath, 'frontend'));

  await writeFile(join(rootPath, '.ewokbot', '.env'), ['OPENCODE_COMMAND=opencode-from-env', 'ANTHROPIC_API_KEY=workspace-secret', ''].join('\n'), 'utf8');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async ({ gates, logRootPath }) => {
        assert.deepEqual(gates.map((gate) => gate.name), ['test']);
        assert.match(logRootPath, /.ewokbot\/runs\/AI-101\/dev-run-1\/quality-logs/u);
        return qualityReport;
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Development execution requested for AI-101/u);
  assert.match(captured.stdout, /Execution boundary confirmed before run state, git, OpenCode, and quality side effects/u);
  assert.match(captured.stdout, /Repository: agentic\/frontend/u);
  assert.match(captured.stdout, /Branch: agent\/AI-101-dev-frontend-local-path/u);
  assert.match(captured.stdout, /Final State: LOCAL_CHECKS_PASSED/u);
  assert.match(captured.stdout, /Local-only boundary preserved/u);
  assert.equal(captured.stderr, '');

  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.equal(clients.atlassian.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.listBacklog), false);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.equal(devRunner.calls.length, 1);
  const devRunInput = devRunner.calls[0];
  assert.ok(devRunInput !== undefined);
  assert.ok(devRunInput.environment !== undefined);
  assert.equal(devRunInput.environment.OPENCODE_COMMAND, 'opencode-from-env');
  assert.equal(devRunInput.environment.ANTHROPIC_API_KEY, 'workspace-secret');
  assert.doesNotMatch(captured.stdout, /workspace-secret/u);
  assert.doesNotMatch(captured.stderr, /workspace-secret/u);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse']);
  assert.equal(gitCalls.some((call) => call.args[0] === 'push'), false);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'LOCAL_CHECKS_PASSED');
  assert.equal(state.targetRepositories.length, 1);
  assert.equal(state.pullRequests.length, 0);
  assert.equal(state.stagingDeployments.length, 0);
  assert.equal(state.branches.length, 1);
  assert.equal(state.devRuns.length, 1);
  assert.equal(state.qualityReports.length, 1);
  assert.match(await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'final-report.md'), 'utf8'), /Development execution stopped after local OpenCode implementation and local quality gates/u);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'implementation-log.md'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'quality-report.md'))).isFile(), true);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command refuses zero selected repositories before state, git, OpenCode, or quality', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('zero');
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;
  const devRunner = createFakeDevRunner();

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /requires exactly one selected repository/u);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assert.rejects(stat(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1'))));
});

test('run-dev command refuses multiple selected repositories before state, git, OpenCode, or quality', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('multi'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('multi');
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;
  const devRunner = createFakeDevRunner();

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /planning selected 2/u);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assert.rejects(stat(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1'))));
});

test('run-dev command refuses existing run directory or state before local side effects', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const runDirectoryPath = join(rootPath, getRunDirectoryPath('AI-101', 'dev-run-1'));
  const statePath = join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1'));
  const existingState = '{"sentinel":"keep-existing-state"}\n';
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;
  const devRunner = createFakeDevRunner();

  await mkdir(runDirectoryPath, { recursive: true });
  await writeFile(statePath, existingState, 'utf8');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /already exists/u);
  assert.equal(await readFile(statePath, 'utf8'), existingState);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-run-dev-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

async function createRunDevWorkspace(t: TestContext, configYaml: string): Promise<string> {
  const rootPath = await createTempRoot(t);

  await mkdir(join(rootPath, '.ewokbot'), { recursive: true });
  await mkdir(join(rootPath, 'frontend'), { recursive: true });
  await mkdir(join(rootPath, 'api'), { recursive: true });
  await writeFile(join(rootPath, '.ewokbot', 'workspace.yml'), configYaml, 'utf8');
  await writeFile(join(rootPath, 'frontend', '.agent-quality.yml'), ['commands:', '  test: mock test', 'required:', '  - test', ''].join('\n'), 'utf8');
  await writeFile(join(rootPath, 'api', '.agent-quality.yml'), ['commands:', '  test: mock test', 'required:', '  - test', ''].join('\n'), 'utf8');

  return rootPath;
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
      stdout: (text) => {
        captured.stdout += text;
      },
      stderr: (text) => {
        captured.stderr += text;
      }
    }
  };
}

function createRunDevMcpClients(ticketShape: 'single' | 'zero' | 'multi'): Record<string, MockMcpClient> {
  return {
    atlassian: new MockMcpClient([
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({ content: { issues: [jiraIssue(ticketShape)] }, isError: false })),
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({ content: { issue: jiraIssue(ticketShape) }, isError: false }))
    ]),
    github: new MockMcpClient([
      createMockMcpTool('github', defaultGitHubMcpToolNames.createBranch, () => ({ content: { branch: { headSha: 'github-head' } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, () => ({ content: { pullRequest: { number: 1, url: 'https://github.example.test/pull/1', targetBranch: 'develop' } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.getChecks, () => ({ content: { checks: { status: 'passed', totalCount: 1, passedCount: 1, failedCount: 0, pendingCount: 0 } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.commentOnPullRequest, () => ({ content: { ok: true }, isError: false }))
    ]),
    railway: new MockMcpClient([
      createMockMcpTool('railway', defaultRailwayMcpToolNames.waitForDeployment, () => ({ content: { deployment: railwayDeployment() }, isError: false })),
      createMockMcpTool('railway', defaultRailwayMcpToolNames.readDeployment, () => ({ content: { deployment: railwayDeployment() }, isError: false })),
      createMockMcpTool('railway', defaultRailwayMcpToolNames.getServiceUrl, () => ({ content: { deployment: { serviceUrl: 'https://frontend.example.test' } }, isError: false }))
    ])
  };
}

function jiraIssue(ticketShape: 'single' | 'zero' | 'multi'): JsonObject {
  const labels = ticketShape === 'zero' ? ['unknown'] : ticketShape === 'multi' ? ['frontend', 'api'] : ['frontend'];
  const summary = ticketShape === 'zero' ? 'Unknown local path' : ticketShape === 'multi' ? 'Dev frontend and api local path' : 'Dev frontend local path';

  return {
    key: 'AI-101',
    fields: {
      summary,
      description: 'Implement the requested local-only development change.',
      status: { name: 'To Do' },
      priority: { name: 'High' },
      labels,
      created: '2026-06-05T00:00:00.000Z',
      updated: '2026-06-05T00:00:00.000Z'
    }
  };
}

function railwayDeployment(): JsonObject {
  return {
    ref: {
      projectId: 'project-1',
      serviceId: 'service-1',
      deploymentId: 'deployment-1',
      environment: 'staging'
    },
    status: 'success',
    branch: 'develop',
    commitSha: 'local-head',
    serviceUrl: 'https://frontend.example.test',
    startedAt: '2026-06-05T00:00:00.000Z',
    finishedAt: '2026-06-05T00:01:00.000Z',
    summary: 'Mock Railway deployment should not be called by run-dev.'
  };
}

function fakeGitResult(input: GitCommandInput): GitCommandResult {
  if (input.args[0] === 'show-ref') {
    return { stdout: '', stderr: '', exitCode: 1 };
  }

  if (input.args[0] === 'rev-parse') {
    return { stdout: 'local-head\n', stderr: '', exitCode: 0 };
  }

  return { stdout: '', stderr: '', exitCode: 0 };
}

function createFakeDevRunner(): DevRunner & { readonly calls: readonly DevRunInput[] } {
  const calls: DevRunInput[] = [];

  return {
    get calls() {
      return calls;
    },
    async run(input) {
      calls.push(input);
      await mkdir(dirname(input.implementationLogPath), { recursive: true });
      await writeFile(input.implementationLogPath, `# Implementation Log\n\n${input.prompt}\n`, 'utf8');

      return createPassedDevRun(input);
    }
  };
}

function createPassedDevRun(input: DevRunInput): DevRunResult {
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
    startedAt: '2026-06-05T00:00:00.000Z',
    finishedAt: '2026-06-05T00:00:01.000Z',
    durationMs: 1000,
    attempts: [
      {
        attempt: 1,
        command: input.command,
        workingDirectory: input.workingDirectory,
        startedAt: '2026-06-05T00:00:00.000Z',
        finishedAt: '2026-06-05T00:00:01.000Z',
        durationMs: 1000,
        exitCode: 0,
        status: 'passed',
        summary: 'Fake OpenCode implementation passed.'
      }
    ],
    status: 'passed',
    summary: 'Fake OpenCode implementation passed.'
  };
}

function createPassedQualityReport(repositoryPath: string): QualityReport {
  return {
    status: 'passed',
    required: [
      {
        name: 'test',
        command: 'mock test',
        workingDirectory: repositoryPath,
        startedAt: '2026-06-05T00:00:00.000Z',
        finishedAt: '2026-06-05T00:00:01.000Z',
        durationMs: 1000,
        exitCode: 0,
        stdoutLogPath: '.ewokbot/runs/AI-101/dev-run-1/quality-logs/test.stdout.log',
        stderrLogPath: '.ewokbot/runs/AI-101/dev-run-1/quality-logs/test.stderr.log',
        status: 'passed',
        summary: 'Mock quality gate passed.'
      }
    ],
    optional: []
  };
}

function fixedClock(): () => Date {
  let tick = 0;
  return () => {
    const date = new Date(Date.UTC(2026, 5, 5, 0, 0, tick));
    tick += 1;
    return date;
  };
}

async function assertNoProviderHandoffFiles(rootPath: string, ticketKey: string, runId: string): Promise<void> {
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', ticketKey, runId, 'staging-report.md')));
  await assert.rejects(stat(join(rootPath, getOperationLedgerFilePath(ticketKey, runId))));
}

function runDevWorkspaceYaml(shape: 'single' | 'multi'): string {
  const apiRepository = shape === 'multi'
    ? [
        '  - name: api',
        '    url: https://github.com/agentic/api',
        '    local_path: ./api',
        '    default_branch: develop',
        '    production_branch: main',
        '    quality_profile: node',
        '    hints:',
        '      - api',
        '    staging_smoke_urls:',
        '      - /health'
      ].join('\n')
    : '';

  return `
workspace:
  name: Run Dev Test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - AI
  mcp_server: atlassian
github:
  mode: mcp
  organization: agentic
  mcp_server: github
railway:
  mode: mcp
  staging_branch: develop
  production_branch: main
  mcp_server: railway
dev_runner:
  mode: mock
  provider: opencode
  command: opencode
  max_attempts: 1
quality:
  default_profile: node
mcp_servers:
  atlassian:
    display_name: Atlassian MCP
    url: https://mcp.example.test/atlassian
  github:
    display_name: GitHub MCP
    url: https://mcp.example.test/github
  railway:
    display_name: Railway MCP
    url: https://mcp.example.test/railway
repos:
  - name: frontend
    url: https://github.com/agentic/frontend
    local_path: ./frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
${apiRepository}
`;
}
