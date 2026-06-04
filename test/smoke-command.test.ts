import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MockMcpClient,
  MockSmokeUrlVerifier,
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
  type GitCommandInput,
  type GitCommandResult,
  type JsonObject,
  type McpToolCallAuditRecord,
  type QualityReport
} from '../src/index.js';

test('smoke command refuses missing confirmation before doctor, config, MCP, or state', async (t) => {
  const rootPath = await createTempRoot(t);
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /missing --confirm-real-provider-smoke/u);
  assert.deepEqual(clients.atlassian.listToolRequests, []);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  await assert.rejects(stat(join(rootPath, 'runs')));
});

test('smoke command stops on doctor fail before MCP readiness or run state', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: {
      commandExists: (command) => command !== 'opencode'
    },
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Phase 1\/6: running local doctor/u);
  assert.match(captured.stdout, /FAIL: OpenCode/u);
  assert.match(captured.stderr, /Smoke preflight failed/u);
  assert.deepEqual(clients.atlassian.listToolRequests, []);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  await assert.rejects(stat(join(rootPath, 'runs')));
});

test('smoke command runs one MCP-backed ticket through production PR preparation with fakes only', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const auditRecords: McpToolCallAuditRecord[] = [];
  const gitCalls: GitCommandInput[] = [];
  const qualityReport = createPassedQualityReport(join(rootPath, 'worktrees', 'frontend'));

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true },
    runtimeMcp: {
      mcpClients: clients,
      mcpAuditSink: (records) => auditRecords.push(...records)
    },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      qualityRunner: async ({ gates, logRootPath }) => {
        assert.deepEqual(gates.map((gate) => gate.name), ['test']);
        assert.match(logRootPath, /runs\/AE-101\/smoke-run-1\/quality-logs/u);
        return qualityReport;
      },
      smokeVerifier: new MockSmokeUrlVerifier()
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Real-provider smoke run requested for AE-101/u);
  assert.match(captured.stdout, /Provider Modes: Jira=mcp, GitHub=mcp, Railway=mcp/u);
  assert.match(captured.stdout, /Smoke run AE-101 completed as smoke-run-1/u);
  assert.match(captured.stdout, /Final State: PRODUCTION_PR_OPENED/u);
  assert.match(captured.stdout, /Human-only production boundary/u);
  assert.equal(captured.stderr, '');

  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.equal(clients.atlassian.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.listBacklog), false);
  assert.deepEqual(clients.github.toolCallRequests.map((call) => call.toolName), [
    defaultGitHubMcpToolNames.createBranch,
    defaultGitHubMcpToolNames.openPullRequest,
    defaultGitHubMcpToolNames.commentOnPullRequest,
    defaultGitHubMcpToolNames.getChecks,
    defaultGitHubMcpToolNames.openPullRequest
  ]);
  assert.deepEqual(clients.railway.toolCallRequests.map((call) => call.toolName), [
    defaultRailwayMcpToolNames.waitForDeployment,
    defaultRailwayMcpToolNames.getServiceUrl
  ]);
  assert.ok(gitCalls.some((call) => call.args[0] === 'push'));
  assert.deepEqual(auditRecords.filter((record) => record.status === 'succeeded').map((record) => `${record.port}.${record.action}`), [
    'TicketPort.getTicket',
    'CodeHostPort.createBranch',
    'CodeHostPort.openPullRequest',
    'CodeHostPort.commentOnPullRequest',
    'CodeHostPort.getChecks',
    'DeploymentPort.waitForDeployment',
    'DeploymentPort.getServiceUrl',
    'CodeHostPort.openPullRequest'
  ]);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'PRODUCTION_PR_OPENED');
  assert.equal(state.targetRepositories.length, 1);
  assert.equal(state.pullRequests.length, 2);
  assert.equal(state.stagingDeployments[0]?.status, 'success');
  assert.match(await readFile(join(rootPath, 'runs', 'AE-101', 'smoke-run-1', 'final-report.md'), 'utf8'), /Real-provider smoke run completed only through production PR preparation/u);
  assert.equal((await stat(join(rootPath, getOperationLedgerFilePath('AE-101', 'smoke-run-1')))).isFile(), true);
});

test('smoke command refuses an existing state file before delivery side effects', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const runDirectoryPath = join(rootPath, getRunDirectoryPath('AE-101', 'smoke-run-1'));
  const statePath = join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1'));
  const existingState = '{"sentinel":"keep-existing-state"}\n';
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;

  await mkdir(runDirectoryPath, { recursive: true });
  await writeFile(statePath, existingState, 'utf8');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      qualityRunner: async ({ gates: _gates, logRootPath: _logRootPath }) => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'worktrees', 'frontend'));
      },
      smokeVerifier: new MockSmokeUrlVerifier()
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /already exists/u);
  assert.equal(await readFile(statePath, 'utf8'), existingState);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(qualityCalls, 0);
  await assertNoSmokeSideEffectFiles(rootPath);
});

test('smoke command refuses an existing run directory before delivery side effects', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const runDirectoryPath = join(rootPath, getRunDirectoryPath('AE-101', 'smoke-run-1'));
  const statePath = join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1'));
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;

  await mkdir(runDirectoryPath, { recursive: true });

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      qualityRunner: async ({ gates: _gates, logRootPath: _logRootPath }) => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'worktrees', 'frontend'));
      },
      smokeVerifier: new MockSmokeUrlVerifier()
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /already exists/u);
  assert.equal((await stat(runDirectoryPath)).isDirectory(), true);
  await assert.rejects(stat(statePath));
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(qualityCalls, 0);
  await assertNoSmokeSideEffectFiles(rootPath);
});

test('smoke command requires explicit MCP modes before runtime adapters', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml().replace('github:\n  mode: mcp', 'github:\n  mode: mock'));
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true },
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /requires Jira, GitHub, and Railway provider modes to be explicit MCP mode/u);
  assert.deepEqual(clients.github.listToolRequests, []);
  await assert.rejects(stat(join(rootPath, 'runs')));
});

test('smoke command stops on MCP readiness failure before Jira read or run state', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  clients.github = new MockMcpClient([]);
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true },
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /Smoke preflight failed while validating MCP readiness/u);
  assert.match(captured.stderr, /No run state, git, OpenCode, PR, deployment, ledger, or provider writes were started/u);
  assert.deepEqual(clients.atlassian.toolCallRequests, []);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  await assert.rejects(stat(join(rootPath, 'runs')));
});

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-smoke-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

async function createSmokeWorkspace(t: TestContext, configYaml: string): Promise<string> {
  const rootPath = await createTempRoot(t);
  const repoPath = join(rootPath, 'worktrees', 'frontend');

  await mkdir(join(rootPath, 'config'), { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await writeFile(join(rootPath, 'config', 'workspace.yml'), configYaml, 'utf8');
  await writeFile(join(rootPath, '.env.example'), ['GITHUB_ORG=', 'GITHUB_TOKEN=', 'JIRA_BASE_URL=', 'JIRA_EMAIL=', 'JIRA_API_TOKEN=', 'RAILWAY_TOKEN=', ''].join('\n'), 'utf8');
  await writeFile(join(rootPath, '.env'), ['GITHUB_ORG=redacted', 'GITHUB_TOKEN=redacted', 'JIRA_BASE_URL=redacted', 'JIRA_EMAIL=redacted', 'JIRA_API_TOKEN=redacted', 'RAILWAY_TOKEN=redacted', ''].join('\n'), 'utf8');
  await writeFile(join(repoPath, '.agent-quality.yml'), ['commands:', '  test: mock test', 'required:', '  - test', ''].join('\n'), 'utf8');
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
      stdout: (text: string) => {
        captured.stdout += text;
      },
      stderr: (text: string) => {
        captured.stderr += text;
      }
    }
  };
}

function createSmokeMcpClients(): Record<string, MockMcpClient> {
  return {
    atlassian: new MockMcpClient([
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({ content: { issues: [jiraIssue()] }, isError: false })),
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({ content: { issue: jiraIssue() }, isError: false })),
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
    ]),
    github: new MockMcpClient([
      createMockMcpTool('github', defaultGitHubMcpToolNames.createBranch, () => ({ content: { branch: { headSha: 'github-branch-head' } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, (input) => {
        const targetBranch = String(input.arguments.targetBranch);
        const number = targetBranch === 'main' ? 9102 : 9101;
        return { content: { pullRequest: { number, url: `https://github.example.test/pull/${number}`, targetBranch } }, isError: false };
      }),
      createMockMcpTool('github', defaultGitHubMcpToolNames.getChecks, () => ({ content: { checks: { status: 'passed', totalCount: 1, passedCount: 1, failedCount: 0, pendingCount: 0 } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.commentOnPullRequest, () => ({ content: { ok: true }, isError: false }))
    ]),
    railway: new MockMcpClient([
      createMockMcpTool('railway', defaultRailwayMcpToolNames.waitForDeployment, (input) => ({
        content: { deployment: railwayDeployment(String(input.arguments.branch), String(input.arguments.commitSha)) },
        isError: false
      })),
      createMockMcpTool('railway', defaultRailwayMcpToolNames.readDeployment, () => ({ content: { deployment: railwayDeployment('develop', 'local-head') }, isError: false })),
      createMockMcpTool('railway', defaultRailwayMcpToolNames.getServiceUrl, () => ({ content: { deployment: { serviceUrl: 'https://frontend.example.test' } }, isError: false }))
    ])
  };
}

function jiraIssue(): JsonObject {
  return {
    key: 'AE-101',
    fields: {
      summary: 'Smoke frontend real provider path',
      description: 'Validate the frontend delivery smoke run.',
      status: { name: 'To Do' },
      priority: { name: 'High' },
      labels: ['frontend'],
      created: '2026-06-05T00:00:00.000Z',
      updated: '2026-06-05T00:00:00.000Z'
    }
  };
}

function railwayDeployment(branch: string, commitSha: string): JsonObject {
  return {
    ref: {
      projectId: 'project-1',
      serviceId: 'service-1',
      deploymentId: 'deployment-1',
      environment: 'staging'
    },
    status: 'success',
    branch,
    commitSha,
    serviceUrl: 'https://frontend.example.test',
    startedAt: '2026-06-05T00:00:00.000Z',
    finishedAt: '2026-06-05T00:01:00.000Z',
    summary: 'Mock Railway MCP staging deployment succeeded.'
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
        stdoutLogPath: 'runs/AE-101/smoke-run-1/quality-logs/test.stdout.log',
        stderrLogPath: 'runs/AE-101/smoke-run-1/quality-logs/test.stderr.log',
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

async function assertNoSmokeSideEffectFiles(rootPath: string): Promise<void> {
  await assert.rejects(stat(join(rootPath, 'runs', 'AE-101', 'smoke-run-1', 'plan.md')));
  await assert.rejects(stat(join(rootPath, 'runs', 'AE-101', 'smoke-run-1', 'implementation-log.md')));
  await assert.rejects(stat(join(rootPath, 'runs', 'AE-101', 'smoke-run-1', 'quality-report.md')));
  await assert.rejects(stat(join(rootPath, 'runs', 'AE-101', 'smoke-run-1', 'staging-report.md')));
  await assert.rejects(stat(join(rootPath, 'runs', 'AE-101', 'smoke-run-1', 'final-report.md')));
  await assert.rejects(stat(join(rootPath, getOperationLedgerFilePath('AE-101', 'smoke-run-1'))));
}

function smokeWorkspaceYaml(): string {
  return `
workspace:
  name: Smoke Test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - AE
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
    local_path: ./worktrees/frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
`;
}
