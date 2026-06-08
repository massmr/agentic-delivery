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
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs')));
});

test('smoke command stops on doctor fail before MCP readiness or run state', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: {
      commandExists: (command) => command !== 'opencode',
      opencodeHomeDirectory: join(rootPath, 'opencode-home')
    },
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Phase 1\/3: running local doctor/u);
  assert.match(captured.stdout, /FAIL: OpenCode/u);
  assert.match(captured.stderr, /Smoke preflight failed/u);
  assert.deepEqual(clients.atlassian.listToolRequests, []);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs')));
});

test('smoke command reads one Jira MCP ticket and stays on local checks only', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const auditRecords: McpToolCallAuditRecord[] = [];
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: {
      mcpClients: clients,
      mcpAuditSink: (records) => auditRecords.push(...records)
    },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({ calls: gitCalls }),
      devRunner,
      qualityRunner: async ({ gates, logRootPath }) => {
        qualityCalls += 1;
        assert.deepEqual(gates.map((gate) => gate.name), ['test']);
        assert.match(logRootPath, /.ewokbot\/runs\/AE-101\/smoke-run-1\/quality-logs/u);
        return createPassedQualityReport(join(rootPath, 'frontend'), 'pnpm test');
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /AT Jira-only smoke run requested for AE-101/u);
  assert.match(captured.stdout, /Execution boundary confirmed/u);
  assert.match(captured.stdout, /Final State: LOCAL_CHECKS_PASSED/u);
  assert.match(captured.stdout, /Run Directory: \.ewokbot\/runs\/AE-101\/smoke-run-1/u);
  assert.match(captured.stdout, /Plan Report: \.ewokbot\/runs\/AE-101\/smoke-run-1\/plan\.md/u);
  assert.match(captured.stdout, /Implementation Log: \.ewokbot\/runs\/AE-101\/smoke-run-1\/implementation-log\.md/u);
  assert.match(captured.stdout, /Meaningful Diff Report: \.ewokbot\/runs\/AE-101\/smoke-run-1\/meaningful-diff\.json/u);
  assert.match(captured.stdout, /Agent Completion Report: \.ewokbot\/runs\/AE-101\/smoke-run-1\/agent-completion\.json/u);
  assert.match(captured.stdout, /Core Safety Report: \.ewokbot\/runs\/AE-101\/smoke-run-1\/core-safety\.json/u);
  assert.match(captured.stdout, /Quality Report: \.ewokbot\/runs\/AE-101\/smoke-run-1\/quality-report\.md/u);
  assert.match(captured.stdout, /Test Relevance Report: \.ewokbot\/runs\/AE-101\/smoke-run-1\/test-relevance\.json/u);
  assert.match(captured.stdout, /Final Report: \.ewokbot\/runs\/AE-101\/smoke-run-1\/final-report\.md/u);
  assert.match(captured.stdout, /no git push, GitHub PR, Railway\/Vercel deployment verification, operation ledger, Jira comment\/transition, staging report/u);
  assert.doesNotMatch(captured.stdout, /Provider Modes: Jira=mcp, GitHub=mcp, Railway=mcp/u);
  assert.doesNotMatch(captured.stdout, /Phase 5\/6: delivery contracts completed through staging verification/u);
  assert.doesNotMatch(captured.stdout, /Phase 6\/6: production PR preparation completed; merge\/deploy remains human-only\./u);
  assert.equal(captured.stderr, '');

  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => ({ toolName: call.toolName, arguments: call.arguments })), [
    {
      toolName: defaultJiraMcpToolNames.getTicket,
      arguments: { issueKey: 'AE-101' }
    }
  ]);
  assert.equal(clients.atlassian.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.listBacklog), false);
  assert.equal(clients.atlassian.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.comment), false);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(auditRecords.map((record) => `${record.port}.${record.action}:${record.status}`), [
    'TicketPort.getTicket:started',
    'TicketPort.getTicket:succeeded'
  ]);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff', 'status', 'diff']);
  assert.equal(devRunner.calls.length, 1);
  assert.equal(devRunner.calls[0]?.ticketKey, 'AE-101');
  assert.equal(qualityCalls, 1);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'LOCAL_CHECKS_PASSED');
  assert.equal(state.targetRepositories.length, 1);
  assert.equal(state.branches.length, 1);
  assert.equal(state.pullRequests.length, 0);
  assert.equal(state.stagingDeployments.length, 0);
  assert.equal(state.qualityReports.length, 1);
  assert.equal(state.devRuns.length, 1);
  assert.equal(state.meaningfulDiff?.decision, 'passed');
  assert.equal(state.agentCompletion?.decision, 'pass');
  assert.equal(state.coreSafety?.decision, 'pass');
  assert.equal(state.testRelevance?.decision, 'pass');
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'plan.md'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'implementation-log.md'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'meaningful-diff.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'agent-completion.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'core-safety.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'test-relevance.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'quality-report.md'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'final-report.md'))).isFile(), true);
  const finalReport = await readFile(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'final-report.md'), 'utf8');
  assert.match(finalReport, /Jira ticket read through TicketPort\.getTicket/u);
  assert.match(finalReport, /local branch creation, OpenCode\/dev-runner execution, meaningful diff inspection, agent completion evaluation, core safety evaluation, local quality gates, test relevance evaluation/u);
  assert.match(finalReport, /did not transition or comment on Jira, push git branches, open GitHub pull requests, call Railway or Vercel/u);
  assert.match(finalReport, /write an operation ledger, write a staging report, merge production, or deploy production/u);
  await assertNoProviderHandoffFiles(rootPath);
});

test('smoke command ignores non-AT provider env readiness and does not call their MCP clients', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceWithProviderMcpYaml(), {
    envLines: ['GITHUB_PERSONAL_ACCESS_TOKEN=redacted', 'ATLASSIAN_BASE_URL=redacted', 'ATLASSIAN_EMAIL=redacted', 'ATLASSIAN_API_TOKEN=redacted', 'VERCEL_TOKEN=redacted']
  });
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const auditRecords: McpToolCallAuditRecord[] = [];
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: {
      mcpClients: clients,
      mcpAuditSink: (records) => auditRecords.push(...records)
    },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({ calls: gitCalls }),
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'), 'pnpm test');
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Final State: LOCAL_CHECKS_PASSED/u);
  assert.doesNotMatch(captured.stdout, /FAIL: GitHub/u);
  assert.doesNotMatch(captured.stdout, /FAIL: Railway/u);
  assert.doesNotMatch(captured.stdout, /FAIL: Vercel/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(auditRecords.map((record) => `${record.port}.${record.action}:${record.status}`), [
    'TicketPort.getTicket:started',
    'TicketPort.getTicket:succeeded'
  ]);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff', 'status', 'diff']);
  assert.equal(devRunner.calls.length, 1);
  assert.equal(qualityCalls, 1);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'LOCAL_CHECKS_PASSED');
  assert.equal(state.pullRequests.length, 0);
  assert.equal(state.stagingDeployments.length, 0);
  await assertNoProviderHandoffFiles(rootPath);
});

test('smoke command refuses an existing state file before delivery side effects', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const runDirectoryPath = join(rootPath, getRunDirectoryPath('AE-101', 'smoke-run-1'));
  const statePath = join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1'));
  const existingState = '{"sentinel":"keep-existing-state"}\n';
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  await mkdir(runDirectoryPath, { recursive: true });
  await writeFile(statePath, existingState, 'utf8');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async ({ gates: _gates, logRootPath: _logRootPath }) => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /already exists/u);
  assert.equal(await readFile(statePath, 'utf8'), existingState);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
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
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  await mkdir(runDirectoryPath, { recursive: true });

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async ({ gates: _gates, logRootPath: _logRootPath }) => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
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
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assertNoSmokeSideEffectFiles(rootPath);
});

test('smoke command fails missing Jira MCP readiness before run state, repository branch/git, OpenCode, quality, package-manager, or provider side effects', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  clients.atlassian = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({ content: { issues: [jiraIssue()] }, isError: false })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /Smoke run failed/u);
  assert.match(captured.stderr, /missing required Jira MCP tool/u);
  assert.match(captured.stderr, new RegExp(defaultJiraMcpToolNames.getTicket, 'u'));
  assert.match(captured.stderr, /No git push, GitHub PR, Railway\/Vercel deployment verification, operation ledger/u);
  assert.deepEqual(clients.atlassian.toolCallRequests, []);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(qualityCalls, 0);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs')));
});

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-smoke-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

async function createSmokeWorkspace(t: TestContext, configYaml: string, options: { readonly envLines?: readonly string[] | undefined } = {}): Promise<string> {
  const rootPath = await createTempRoot(t);
  const repoPath = join(rootPath, 'frontend');
  const envLines = options.envLines ?? ['GITHUB_PERSONAL_ACCESS_TOKEN=redacted', 'ATLASSIAN_BASE_URL=redacted', 'ATLASSIAN_EMAIL=redacted', 'ATLASSIAN_API_TOKEN=redacted', 'RAILWAY_TOKEN=redacted'];

  await mkdir(join(rootPath, '.ewokbot'), { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await writeFile(join(rootPath, '.ewokbot', 'workspace.yml'), configYaml, 'utf8');
  await writeFile(join(rootPath, '.ewokbot', '.env.example'), ['GITHUB_PERSONAL_ACCESS_TOKEN=', 'ATLASSIAN_BASE_URL=', 'ATLASSIAN_EMAIL=', 'ATLASSIAN_API_TOKEN=', 'RAILWAY_TOKEN=', ''].join('\n'), 'utf8');
  await writeFile(join(rootPath, '.ewokbot', '.env'), [...envLines, ''].join('\n'), 'utf8');
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

function createFakeGitRunner(output: { readonly calls?: GitCommandInput[] | undefined } = {}): (input: GitCommandInput) => Promise<GitCommandResult> {
  let statusCalls = 0;
  let diffCalls = 0;

  return async (input) => {
    output.calls?.push(input);

    if (input.args[0] === 'status') {
      statusCalls += 1;
      return fakeGitResult(input, { statusPorcelain: statusCalls === 1 ? '' : ' M src/app.ts\n' });
    }

    if (input.args[0] === 'diff') {
      if (input.args.includes('--unified=0')) {
        return fakeGitResult(input, { diffPatch: diffPatch('src/app.ts', ['export const smoke = true;']) });
      }

      diffCalls += 1;
      return fakeGitResult(input, { diffStat: diffCalls === 1 ? '' : ' src/app.ts | 1 +\n 1 file changed, 1 insertion(+)' });
    }

    return fakeGitResult(input);
  };
}

function fakeGitResult(input: GitCommandInput, output: { readonly statusPorcelain?: string | undefined; readonly diffStat?: string | undefined; readonly diffPatch?: string | undefined } = {}): GitCommandResult {
  if (input.args[0] === 'show-ref') {
    return { stdout: '', stderr: '', exitCode: 1 };
  }

  if (input.args[0] === 'rev-parse') {
    return { stdout: 'local-head\n', stderr: '', exitCode: 0 };
  }

  if (input.args[0] === 'status') {
    return { stdout: output.statusPorcelain ?? '', stderr: '', exitCode: 0 };
  }

  if (input.args[0] === 'diff') {
    return { stdout: input.args.includes('--unified=0') ? output.diffPatch ?? '' : output.diffStat ?? '', stderr: '', exitCode: 0 };
  }

  return { stdout: '', stderr: '', exitCode: 0 };
}

function diffPatch(filePath: string, additions: readonly string[]): string {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,0 +1,${additions.length} @@`,
    ...additions.map((line) => `+${line}`),
    ''
  ].join('\n');
}

function createFakeDevRunner(implementationLog: string): DevRunner & { readonly calls: readonly DevRunInput[] } {
  const calls: DevRunInput[] = [];

  return {
    get calls() {
      return calls;
    },
    async run(input) {
      calls.push(input);
      await mkdir(dirname(input.implementationLogPath), { recursive: true });
      await writeFile(input.implementationLogPath, `# Implementation Log\n\n${input.prompt}\n\n${implementationLog}\n`, 'utf8');

      return createPassedDevRun(input);
    }
  };
}

function completionLog(input: {
  readonly status: 'completed' | 'blocked' | 'incomplete';
  readonly changedFiles: string;
  readonly testsRun: string;
  readonly knownLimits: string;
  readonly blockers: string;
  readonly backgroundAgents: string;
}): string {
  return [
    '## Required Final Completion Summary',
    `Status: ${input.status}`,
    `Changed files: ${input.changedFiles}`,
    `Tests run: ${input.testsRun}`,
    `Known limits: ${input.knownLimits}`,
    `Blockers: ${input.blockers}`,
    `Background agents: ${input.backgroundAgents}`,
    ''
  ].join('\n');
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

function createPassedQualityReport(repositoryPath: string, command = 'mock test'): QualityReport {
  return {
    status: 'passed',
    required: [
      {
        name: 'test',
        command,
        workingDirectory: repositoryPath,
        startedAt: '2026-06-05T00:00:00.000Z',
        finishedAt: '2026-06-05T00:00:01.000Z',
        durationMs: 1000,
        exitCode: 0,
        stdoutLogPath: '.ewokbot/runs/AE-101/smoke-run-1/quality-logs/test.stdout.log',
        stderrLogPath: '.ewokbot/runs/AE-101/smoke-run-1/quality-logs/test.stderr.log',
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
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'plan.md')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'implementation-log.md')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'quality-report.md')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'staging-report.md')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'final-report.md')));
  await assert.rejects(stat(join(rootPath, getOperationLedgerFilePath('AE-101', 'smoke-run-1'))));
}

async function assertNoProviderHandoffFiles(rootPath: string): Promise<void> {
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'staging-report.md')));
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
  max_attempts: 1
quality:
  default_profile: node
mcp_servers:
  atlassian:
    transport: stdio
    command: mcp-atlassian
    args: []
    env_var_names:
      - ATLASSIAN_BASE_URL
      - ATLASSIAN_EMAIL
      - ATLASSIAN_API_TOKEN
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
`;
}

function smokeWorkspaceWithProviderMcpYaml(): string {
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
    transport: stdio
    command: mcp-atlassian
    args: []
    env_var_names:
      - ATLASSIAN_BASE_URL
      - ATLASSIAN_EMAIL
      - ATLASSIAN_API_TOKEN
  github:
    display_name: GitHub MCP
    command: docker
    args:
      - run
      - -i
      - --rm
      - -e
      - GITHUB_PERSONAL_ACCESS_TOKEN
      - ghcr.io/github/github-mcp-server
    env_var_names:
      - GITHUB_PERSONAL_ACCESS_TOKEN
  railway:
    display_name: Railway MCP
    command: railway
    args:
      - mcp
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
`;
}
